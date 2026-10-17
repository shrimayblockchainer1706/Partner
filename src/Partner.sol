// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Partner - a trustless rotating savings circle (ROSCA / chit fund / committee)
/// @notice N members each pay `contribution` in wei every round. In round r the member
///         who owns slot r receives the whole pot. Members pick a payout slot when they
///         join and lock ETH collateral sized to the contributions they will still owe
///         after they have received the pot. Collateral is refunded at the end, minus
///         whatever was slashed to cover missed payments.
/// @dev Native ETH only. No ERC20, no approvals. Security: ReentrancyGuard on every
///      state-changing function and checks-effects-interactions (all storage is settled
///      before any ETH is sent).
///
///      KNOWN LIMITATION: closeRound pushes ETH with a raw call. If the recipient is a
///      contract that rejects ETH, closeRound reverts and the round cannot be closed.
///      Adding a pull-payment withdraw() is the roadmap fix.
///
///      There is intentionally no receive()/fallback(), so stray ETH is rejected.
contract Partner is ReentrancyGuard {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice Lifecycle of a circle.
    enum CircleStatus {
        Open, // still accepting members
        Active, // full; rounds are running
        Completed // all rounds paid out; collateral refunded
    }

    /// @notice Data for a single savings circle.
    struct Circle {
        address creator; // who created the circle (not auto-joined)
        uint256 contribution; // wei paid by each member per round
        uint256 roundDuration; // seconds a round lasts
        uint256 roundStart; // timestamp the current round began
        uint8 maxMembers; // number of members and number of rounds (2..12)
        uint8 currentRound; // round currently being paid out (0-based)
        uint8 slotsFilled; // how many slots have been claimed
        CircleStatus status; // Open / Active / Completed
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Number of circles created so far; a new circle's id equals the count before increment.
    uint256 public circleCount;

    mapping(uint256 => Circle) private circles;
    /// @notice circleId => slot => member (address(0) means the slot is free).
    mapping(uint256 => mapping(uint8 => address)) public slotOwner;
    /// @notice circleId => member => chosen payout slot.
    mapping(uint256 => mapping(address => uint8)) public slotOf;
    /// @notice circleId => member => whether the address belongs to the circle.
    mapping(uint256 => mapping(address => bool)) public isMember;
    /// @notice circleId => member => collateral still locked (wei).
    mapping(uint256 => mapping(address => uint256)) public collateral;
    /// @notice circleId => round => member => whether they have paid that round.
    mapping(uint256 => mapping(uint8 => mapping(address => bool))) public hasPaid;
    /// @notice circleId => member => number of missed payments in this circle.
    mapping(uint256 => mapping(address => uint256)) public circleDefaults;

    /// @notice Lifetime circles a member finished without a single default.
    mapping(address => uint256) public completedCircles;
    /// @notice Lifetime missed payments across all circles.
    mapping(address => uint256) public totalDefaults;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event CircleCreated(
        uint256 indexed circleId,
        address indexed creator,
        uint256 contribution,
        uint8 maxMembers,
        uint256 roundDuration
    );
    event Joined(uint256 indexed circleId, address indexed member, uint8 slot, uint256 collateral);
    event Contributed(uint256 indexed circleId, address indexed member, uint8 round, uint256 amount);
    event RoundClosed(uint256 indexed circleId, uint8 indexed round, address indexed recipient, uint256 pot);
    event Defaulted(uint256 indexed circleId, uint8 indexed round, address indexed member);
    event CircleCompleted(uint256 indexed circleId);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error InvalidParams();
    error CircleNotOpen();
    error CircleNotActive();
    error SlotOutOfRange();
    error SlotTaken();
    error AlreadyMember();
    error NotMember();
    error IncorrectPayment(uint256 expected, uint256 provided);
    error AlreadyPaid();
    error ContributionWindowClosed();
    error RoundNotOver();
    error TransferFailed();

    // -------------------------------------------------------------------------
    // Mutating functions
    // -------------------------------------------------------------------------

    /// @notice Create a new circle. The creator does not automatically join.
    /// @param contribution wei each member pays every round (must be > 0).
    /// @param maxMembers number of members, and therefore rounds (2..12).
    /// @param roundDuration seconds each round lasts (must be > 0).
    /// @return circleId id of the newly created circle.
    function createCircle(uint256 contribution, uint8 maxMembers, uint256 roundDuration)
        external
        nonReentrant
        returns (uint256 circleId)
    {
        if (contribution == 0 || maxMembers < 2 || maxMembers > 12 || roundDuration == 0) {
            revert InvalidParams();
        }

        circleId = circleCount; // ids start at 0
        circleCount = circleId + 1;

        Circle storage c = circles[circleId];
        c.creator = msg.sender;
        c.contribution = contribution;
        c.roundDuration = roundDuration;
        c.maxMembers = maxMembers;
        c.status = CircleStatus.Open;

        emit CircleCreated(circleId, msg.sender, contribution, maxMembers, roundDuration);
    }

    /// @notice Join an open circle at a chosen payout slot by locking the exact collateral.
    /// @param circleId circle to join.
    /// @param slot payout slot to claim (0-based); must be free and in range.
    function joinCircle(uint256 circleId, uint8 slot) external payable nonReentrant {
        Circle storage c = circles[circleId];

        if (c.status != CircleStatus.Open) revert CircleNotOpen();
        if (slot >= c.maxMembers) revert SlotOutOfRange();
        if (slotOwner[circleId][slot] != address(0)) revert SlotTaken();
        if (isMember[circleId][msg.sender]) revert AlreadyMember();

        uint256 required = requiredCollateral(circleId, slot);
        if (msg.value != required) revert IncorrectPayment(required, msg.value);

        slotOwner[circleId][slot] = msg.sender;
        slotOf[circleId][msg.sender] = slot;
        isMember[circleId][msg.sender] = true;
        collateral[circleId][msg.sender] = required;
        c.slotsFilled += 1;

        emit Joined(circleId, msg.sender, slot, required);

        // The member who fills the last free slot starts the circle.
        if (c.slotsFilled == c.maxMembers) {
            c.status = CircleStatus.Active;
            c.currentRound = 0;
            c.roundStart = block.timestamp;
        }
    }

    /// @notice Pay this round's contribution (exactly `contribution` wei) before the round ends.
    /// @param circleId circle to contribute to.
    function contribute(uint256 circleId) external payable nonReentrant {
        Circle storage c = circles[circleId];

        if (c.status != CircleStatus.Active) revert CircleNotActive();
        if (!isMember[circleId][msg.sender]) revert NotMember();
        if (hasPaid[circleId][c.currentRound][msg.sender]) revert AlreadyPaid();
        if (block.timestamp >= c.roundStart + c.roundDuration) revert ContributionWindowClosed();
        if (msg.value != c.contribution) revert IncorrectPayment(c.contribution, msg.value);

        hasPaid[circleId][c.currentRound][msg.sender] = true;
        emit Contributed(circleId, msg.sender, c.currentRound, msg.value);
    }

    /// @notice Close the current round and pay the pot to the member who owns the current slot.
    /// @dev Callable by anyone once the round time is up, or earlier if every member has paid.
    ///      Unpaid members have collateral slashed to keep the pot whole; if collateral is
    ///      exhausted the pot is short (documented limitation of this MVP).
    /// @param circleId circle to advance.
    function closeRound(uint256 circleId) external nonReentrant {
        Circle storage c = circles[circleId];
        if (c.status != CircleStatus.Active) revert CircleNotActive();

        uint8 round = c.currentRound;
        uint8 n = c.maxMembers;

        // Early close is allowed only when everybody has already paid.
        if (block.timestamp < c.roundStart + c.roundDuration) {
            for (uint8 s = 0; s < n; ++s) {
                if (!hasPaid[circleId][round][slotOwner[circleId][s]]) revert RoundNotOver();
            }
        }

        // --- Effects: build the pot, slashing collateral of anyone who missed ---
        uint256 pot;
        for (uint8 s = 0; s < n; ++s) {
            address member = slotOwner[circleId][s];
            if (hasPaid[circleId][round][member]) {
                pot += c.contribution;
            } else {
                // Take as much as possible; may be less than one contribution.
                uint256 slash =
                    collateral[circleId][member] >= c.contribution ? c.contribution : collateral[circleId][member];
                collateral[circleId][member] -= slash;
                pot += slash;
                circleDefaults[circleId][member] += 1;
                totalDefaults[member] += 1;
                emit Defaulted(circleId, round, member);
            }
        }

        // --- Effects: settle round/circle state before any ETH moves ---
        bool lastRound = round + 1 == n;
        address recipient = slotOwner[circleId][round]; // this round's slot owner takes the pot

        if (lastRound) {
            c.status = CircleStatus.Completed;
        } else {
            c.currentRound = round + 1;
            c.roundStart = block.timestamp;
        }

        // On the last round, snapshot and zero every member's collateral refund.
        uint256[] memory refunds;
        if (lastRound) {
            refunds = new uint256[](n);
            for (uint8 s = 0; s < n; ++s) {
                address member = slotOwner[circleId][s];
                refunds[s] = collateral[circleId][member];
                collateral[circleId][member] = 0;
                // Reputation: only members with zero defaults earn a completed circle.
                if (circleDefaults[circleId][member] == 0) {
                    completedCircles[member] += 1;
                }
            }
        }

        // --- Interactions: state is fully settled, now send ETH ---
        _send(recipient, pot);
        emit RoundClosed(circleId, round, recipient, pot);

        if (lastRound) {
            for (uint8 s = 0; s < n; ++s) {
                if (refunds[s] > 0) {
                    _send(slotOwner[circleId][s], refunds[s]);
                }
            }
            emit CircleCompleted(circleId);
        }
    }

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice Collateral a member must lock to claim `slot`.
    /// @dev Covers the contributions still owed after payout: contribution * max(1, N-1-slot).
    ///      Reverts (arithmetic underflow) if slot >= maxMembers.
    /// @param circleId circle to inspect.
    /// @param slot payout slot (0-based).
    /// @return required collateral in wei.
    function requiredCollateral(uint256 circleId, uint8 slot) public view returns (uint256) {
        Circle memory c = circles[circleId];
        uint256 owed = c.maxMembers - 1 - uint256(slot); // reverts if slot >= maxMembers
        if (owed == 0) owed = 1; // every member locks at least one contribution
        return c.contribution * owed;
    }

    /// @notice Full circle data.
    function getCircle(uint256 circleId) external view returns (Circle memory) {
        return circles[circleId];
    }

    /// @notice Slot owners indexed by slot (address(0) marks a free slot).
    function getSlots(uint256 circleId) external view returns (address[] memory owners) {
        uint8 n = circles[circleId].maxMembers;
        owners = new address[](n);
        for (uint8 s = 0; s < n; ++s) {
            owners[s] = slotOwner[circleId][s];
        }
    }

    /// @notice Whether each slot's member has paid the current round.
    function getRoundStatus(uint256 circleId) external view returns (bool[] memory paid) {
        Circle storage c = circles[circleId];
        uint8 n = c.maxMembers;
        paid = new bool[](n);
        for (uint8 s = 0; s < n; ++s) {
            paid[s] = hasPaid[circleId][c.currentRound][slotOwner[circleId][s]];
        }
    }

    /// @notice Remaining collateral locked by `member` in `circleId`.
    function getCollateral(uint256 circleId, address member) external view returns (uint256) {
        return collateral[circleId][member];
    }

    /// @notice Reputation of `member`: circles completed with zero defaults, and lifetime defaults.
    function getScore(address member) external view returns (uint256 completed, uint256 defaulted) {
        return (completedCircles[member], totalDefaults[member]);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /// @dev Send native ETH and revert with a custom error on failure.
    ///      If `to` is a contract that rejects ETH, this (and closeRound) reverts.
    function _send(address to, uint256 amount) private {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
