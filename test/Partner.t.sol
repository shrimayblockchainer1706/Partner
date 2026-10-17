// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Partner} from "../src/Partner.sol";

/// @notice Unit tests for Partner: collateral math, the happy path, defaults handled by
///         collateral, access control, and the no-stuck-funds invariant.
contract PartnerTest is Test {
    Partner internal partner;

    uint256 internal constant C = 1 ether; // standard contribution
    uint256 internal constant DAY = 1 days;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal mallory = makeAddr("mallory"); // outsider, never a member

    // keccak256("RoundClosed(uint256,uint8,address,uint256)")
    bytes32 internal constant ROUND_CLOSED_TOPIC = keccak256("RoundClosed(uint256,uint8,address,uint256)");

    function setUp() public {
        partner = new Partner();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
        vm.deal(dave, 100 ether);
        vm.deal(mallory, 100 ether);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /// @dev Join at `slot` with exactly the required collateral.
    function _join(uint256 id, address member, uint8 slot) internal {
        uint256 required = partner.requiredCollateral(id, slot);
        vm.prank(member);
        partner.joinCircle{value: required}(id, slot);
    }

    /// @dev Join at `slot` with an explicit amount (used by revert tests so that no
    ///      external call sits between vm.expectRevert and the call under test).
    function _joinWith(uint256 id, address member, uint8 slot, uint256 value) internal {
        vm.prank(member);
        partner.joinCircle{value: value}(id, slot);
    }

    /// @dev Pay the standard contribution.
    function _pay(uint256 id, address member) internal {
        vm.prank(member);
        partner.contribute{value: C}(id);
    }

    /// @dev Extract the pot and recipient from the most recent RoundClosed log.
    function _lastRoundClosed() internal view returns (uint256 pot, address recipient) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; --i) {
            if (logs[i - 1].topics[0] == ROUND_CLOSED_TOPIC) {
                pot = abi.decode(logs[i - 1].data, (uint256));
                recipient = address(uint160(uint256(logs[i - 1].topics[3])));
                return (pot, recipient);
            }
        }
        revert("RoundClosed not emitted");
    }

    // -------------------------------------------------------------------------
    // 1. Collateral math
    // -------------------------------------------------------------------------

    function test_CollateralMath() public {
        uint256 id = partner.createCircle(C, 4, DAY);
        // N = 4: slot 0 still owes 3 contributions, slot 1 owes 2, slots 2 and 3 owe 1.
        assertEq(partner.requiredCollateral(id, 0), 3 * C);
        assertEq(partner.requiredCollateral(id, 1), 2 * C);
        assertEq(partner.requiredCollateral(id, 2), 1 * C);
        assertEq(partner.requiredCollateral(id, 3), 1 * C);
    }

    // -------------------------------------------------------------------------
    // 2. Happy path: everyone pays every round, pots arrive in slot order
    // -------------------------------------------------------------------------

    function test_HappyPath_AllPayEveryRound() public {
        uint256 id = partner.createCircle(C, 3, DAY);

        uint256 startAlice = alice.balance;
        uint256 startBob = bob.balance;
        uint256 startCarol = carol.balance;

        _join(id, alice, 0); // collateral 2C
        _join(id, bob, 1); // collateral C
        _join(id, carol, 2); // collateral C

        Partner.Circle memory c = partner.getCircle(id);
        assertEq(uint8(c.status), uint8(Partner.CircleStatus.Active));
        assertEq(c.currentRound, 0);

        // Round 0 -> alice
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (uint256 pot0, address r0) = _lastRoundClosed();
        assertEq(pot0, 3 * C);
        assertEq(r0, alice);

        // Round 1 -> bob
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (uint256 pot1, address r1) = _lastRoundClosed();
        assertEq(pot1, 3 * C);
        assertEq(r1, bob);

        // Round 2 -> carol (last round, circle completes)
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (uint256 pot2, address r2) = _lastRoundClosed();
        assertEq(pot2, 3 * C);
        assertEq(r2, carol);

        assertEq(uint8(partner.getCircle(id).status), uint8(Partner.CircleStatus.Completed));

        // Collateral fully refunded: everyone ends exactly where they started.
        assertEq(alice.balance, startAlice);
        assertEq(bob.balance, startBob);
        assertEq(carol.balance, startCarol);
        assertEq(partner.getCollateral(id, alice), 0);
        assertEq(partner.getCollateral(id, bob), 0);
        assertEq(partner.getCollateral(id, carol), 0);

        // Reputation credited to everyone, no defaults.
        assertEq(partner.completedCircles(alice), 1);
        assertEq(partner.completedCircles(bob), 1);
        assertEq(partner.completedCircles(carol), 1);
        assertEq(partner.totalDefaults(alice), 0);
        assertEq(partner.totalDefaults(bob), 0);
        assertEq(partner.totalDefaults(carol), 0);

        // No stuck funds.
        assertEq(address(partner).balance, 0);
    }

    // -------------------------------------------------------------------------
    // 3. KEY TEST: early recipient vanishes; collateral covers exactly
    // -------------------------------------------------------------------------

    function test_EarlyRecipientVanishes_CollateralCovers() public {
        uint256 id = partner.createCircle(C, 4, DAY);
        _join(id, alice, 0); // 3C collateral, payout in round 0
        _join(id, bob, 1); // 2C, payout in round 1
        _join(id, carol, 2); // 1C, payout in round 2
        _join(id, dave, 3); // 1C, payout in round 3

        // Round 0: everyone pays; alice takes the pot, then disappears forever.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        _pay(id, dave);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);

        // Rounds 1..3: alice never pays again. Her 3C collateral must cover all three.
        address[3] memory expected = [bob, carol, dave];
        for (uint8 r = 1; r < 4; ++r) {
            _pay(id, bob);
            _pay(id, carol);
            _pay(id, dave);
            vm.warp(block.timestamp + DAY);
            vm.recordLogs();
            partner.closeRound(id);
            (uint256 pot, address recipient) = _lastRoundClosed();
            assertEq(pot, 4 * C, "later recipient still gets the full pot");
            assertEq(recipient, expected[r - 1]);
        }

        // Alice's 3C collateral covered exactly her three missed rounds.
        assertEq(partner.getCollateral(id, alice), 0);
        assertEq(partner.circleDefaults(id, alice), 3);
        assertEq(partner.totalDefaults(alice), 3);
        assertEq(partner.completedCircles(alice), 0);

        // Everyone else finished cleanly.
        assertEq(partner.completedCircles(bob), 1);
        assertEq(partner.completedCircles(carol), 1);
        assertEq(partner.completedCircles(dave), 1);

        assertEq(uint8(partner.getCircle(id).status), uint8(Partner.CircleStatus.Completed));
        assertEq(address(partner).balance, 0);
    }

    // -------------------------------------------------------------------------
    // 4. A single missed round is covered by collateral; recipient still whole
    // -------------------------------------------------------------------------

    function test_SingleMissedRoundCoveredByCollateral() public {
        uint256 id = partner.createCircle(C, 3, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);
        _join(id, carol, 2);

        // Round 0: all pay -> alice
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);

        // Round 1: carol misses; bob still receives the full 3C pot.
        _pay(id, alice);
        _pay(id, bob);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (uint256 pot, address recipient) = _lastRoundClosed();
        assertEq(pot, 3 * C);
        assertEq(recipient, bob);
        assertEq(partner.circleDefaults(id, carol), 1);
        assertEq(partner.getCollateral(id, carol), 0);

        // Round 2: carol pays again -> carol receives the last pot.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (pot, recipient) = _lastRoundClosed();
        assertEq(pot, 3 * C);
        assertEq(recipient, carol);

        assertEq(partner.completedCircles(alice), 1);
        assertEq(partner.completedCircles(bob), 1);
        assertEq(partner.completedCircles(carol), 0);
        assertEq(address(partner).balance, 0);
    }

    // -------------------------------------------------------------------------
    // 5. Access control and payment checks
    // -------------------------------------------------------------------------

    function test_CannotContributeTwice() public {
        uint256 id = partner.createCircle(C, 2, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);

        _pay(id, alice);
        vm.expectRevert(Partner.AlreadyPaid.selector);
        vm.prank(alice);
        partner.contribute{value: C}(id);
    }

    function test_NonMemberCannotContribute() public {
        uint256 id = partner.createCircle(C, 2, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);

        vm.expectRevert(Partner.NotMember.selector);
        vm.prank(mallory);
        partner.contribute{value: C}(id);
    }

    function test_CannotJoinTakenSlot() public {
        uint256 id = partner.createCircle(C, 3, DAY);
        _join(id, alice, 0);

        vm.expectRevert(Partner.SlotTaken.selector);
        _joinWith(id, bob, 0, 3 * C);
    }

    function test_CannotJoinFullOrNonOpenCircle() public {
        uint256 id = partner.createCircle(C, 2, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1); // now Active

        // Full (Active) circle rejects new members.
        vm.expectRevert(Partner.CircleNotOpen.selector);
        _joinWith(id, carol, 0, 2 * C);

        // Completed circle rejects new members too.
        _pay(id, alice);
        _pay(id, bob);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);
        _pay(id, alice);
        _pay(id, bob);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);
        assertEq(uint8(partner.getCircle(id).status), uint8(Partner.CircleStatus.Completed));

        vm.expectRevert(Partner.CircleNotOpen.selector);
        _joinWith(id, carol, 0, 2 * C);
    }

    function test_CannotJoinOutOfRangeSlot() public {
        uint256 id = partner.createCircle(C, 2, DAY);
        vm.expectRevert(Partner.SlotOutOfRange.selector);
        _joinWith(id, alice, 2, 0);
    }

    function test_WrongJoinValueReverts() public {
        uint256 id = partner.createCircle(C, 4, DAY);
        // slot 0 requires exactly 3C.
        vm.expectRevert(abi.encodeWithSelector(Partner.IncorrectPayment.selector, 3 * C, 3 * C - 1));
        _joinWith(id, alice, 0, 3 * C - 1);

        vm.expectRevert(abi.encodeWithSelector(Partner.IncorrectPayment.selector, 3 * C, 3 * C + 1));
        _joinWith(id, alice, 0, 3 * C + 1);
    }

    function test_WrongContributeValueReverts() public {
        uint256 id = partner.createCircle(C, 2, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);

        vm.expectRevert(abi.encodeWithSelector(Partner.IncorrectPayment.selector, C, C - 1));
        vm.prank(alice);
        partner.contribute{value: C - 1}(id);

        vm.expectRevert(abi.encodeWithSelector(Partner.IncorrectPayment.selector, C, C + 1));
        vm.prank(alice);
        partner.contribute{value: C + 1}(id);
    }

    function test_StrayEthIsRejected() public {
        // No receive()/fallback: a plain transfer must fail.
        (bool ok,) = address(partner).call{value: 1 ether}("");
        assertFalse(ok);
    }

    // -------------------------------------------------------------------------
    // 6. closeRound reverts too early when not everyone has paid
    // -------------------------------------------------------------------------

    function test_CloseRoundTooEarlyReverts() public {
        uint256 id = partner.createCircle(C, 3, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);
        _join(id, carol, 2);

        // Window still open and nobody has paid.
        vm.expectRevert(Partner.RoundNotOver.selector);
        partner.closeRound(id);

        // Still not everyone.
        _pay(id, alice);
        vm.expectRevert(Partner.RoundNotOver.selector);
        partner.closeRound(id);

        // Once everyone has paid it may close early, inside the window.
        _pay(id, bob);
        _pay(id, carol);
        partner.closeRound(id);
        assertEq(partner.getCircle(id).currentRound, 1);

        // After the window ends it closes even with unpaid members (slashing them).
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);
        assertEq(partner.circleDefaults(id, alice), 1);
        assertEq(partner.circleDefaults(id, bob), 1);
        assertEq(partner.circleDefaults(id, carol), 1);
    }

    // -------------------------------------------------------------------------
    // 7. Pre-turn defaulter with insufficient collateral produces a short pot
    // -------------------------------------------------------------------------

    function test_PreTurnDefaulter_ShortPot_KnownLimitation() public {
        uint256 id = partner.createCircle(C, 4, DAY);
        _join(id, alice, 0); // 3C
        _join(id, bob, 1); // 2C
        _join(id, carol, 2); // 1C
        _join(id, dave, 3); // 1C, payout in round 3

        // Round 0: all pay -> alice.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        _pay(id, dave);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);

        // Round 1: dave misses *before* his own payout; his only 1C of collateral is spent.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);
        assertEq(partner.getCollateral(id, dave), 0);

        // Round 2: all pay -> carol.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        _pay(id, dave);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);

        // Round 3: dave is the recipient but also misses again with no collateral left.
        _pay(id, alice);
        _pay(id, bob);
        _pay(id, carol);
        vm.warp(block.timestamp + DAY);
        vm.recordLogs();
        partner.closeRound(id);
        (uint256 pot, address recipient) = _lastRoundClosed();

        // KNOWN LIMITATION: no collateral remains, so the pot is one contribution short.
        assertEq(pot, 3 * C);
        assertEq(recipient, dave);
        assertEq(partner.circleDefaults(id, dave), 2);
        assertEq(partner.completedCircles(dave), 0);
        assertEq(address(partner).balance, 0);
    }

    // -------------------------------------------------------------------------
    // 8. No stuck funds after a circle completes (including a default path)
    // -------------------------------------------------------------------------

    function test_NoStuckFundsAfterCompletion() public {
        uint256 id = partner.createCircle(C, 4, DAY);
        _join(id, alice, 0);
        _join(id, bob, 1);
        _join(id, carol, 2);
        _join(id, dave, 3);

        // Round 0: bob defaults, everyone else pays; collateral keeps the pot whole.
        _pay(id, alice);
        _pay(id, carol);
        _pay(id, dave);
        vm.warp(block.timestamp + DAY);
        partner.closeRound(id);

        // Rounds 1..3: everyone pays.
        for (uint8 r = 1; r < 4; ++r) {
            _pay(id, alice);
            _pay(id, bob);
            _pay(id, carol);
            _pay(id, dave);
            vm.warp(block.timestamp + DAY);
            partner.closeRound(id);
        }

        assertEq(uint8(partner.getCircle(id).status), uint8(Partner.CircleStatus.Completed));
        assertEq(address(partner).balance, 0);
    }
}
