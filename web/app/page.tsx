"use client";

// Landing page: the pitch, a 4-step explainer, and the list of circles.
import Link from "next/link";
import { Button, Card, EmptyState, ErrorState, Spinner, StatusBadge } from "@/components/ui";
import { getChainName } from "@/lib/config";
import { formatDuration, formatEth } from "@/lib/format";
import { useCircles } from "@/lib/useCircles";

const STEPS = [
  { title: "Create a circle", body: "Choose the contribution, member count and round length." },
  { title: "Pick your slot, lock collateral", body: "Earlier slots are paid sooner and lock more collateral." },
  { title: "Contribute every round", body: "Every member pays the contribution into the pot each round." },
  { title: "Get the pot, then collateral back", body: "On your turn you receive the pot; collateral returns at the end." },
];

export default function HomePage() {
  const { circles, isLoading, isError, isSupported, isConfigured, chainId, refetch } = useCircles();

  return (
    <div className="space-y-10">
      {/* Pitch */}
      <section className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Partner</h1>
        <p className="max-w-3xl text-slate-300">
          A trustless savings circle (chit fund / committee) on Ethereum. Smart contracts replace the organizer, and
          position-based collateral protects the group.
        </p>
        <Link href="/create">
          <Button>Create Circle</Button>
        </Link>
      </section>

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-white">How it works</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <Card className="h-full">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-300">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-slate-100">{step.title}</h3>
                <p className="mt-1 text-sm text-slate-400">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      {/* Circles */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Circles</h2>
          <span className="text-sm text-slate-500">{circles.length} total</span>
        </div>

        {!isSupported ? (
          <EmptyState
            title="Unsupported network"
            description="Switch your wallet to Sepolia or Anvil to see the circles."
          />
        ) : !isConfigured ? (
          <EmptyState
            title="Contract not configured"
            description={`No Partner address is set for ${getChainName(chainId)}. Set NEXT_PUBLIC_PARTNER_ADDRESS_SEPOLIA (or NEXT_PUBLIC_PARTNER_ADDRESS_ANVIL) and restart the dev server.`}
          />
        ) : isLoading ? (
          <Card className="flex items-center gap-2 text-sm text-slate-400">
            <Spinner /> Loading circles…
          </Card>
        ) : isError ? (
          <ErrorState message="Could not load circles from the chain." onRetry={refetch} />
        ) : circles.length === 0 ? (
          <EmptyState
            title="No circles yet"
            description="Be the first — create a savings circle and invite your group."
            action={
              <Link href="/create">
                <Button>Create the first circle</Button>
              </Link>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {circles.map(({ id, circle }) => (
              <li key={id}>
                <Link
                  href={`/circle/${id}`}
                  className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <Card className="transition hover:border-slate-600">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-slate-500">Circle</p>
                        <p className="text-lg font-semibold text-white">#{id}</p>
                      </div>
                      <StatusBadge status={circle.status} />
                    </div>
                    <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-slate-500">Contribution</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">{formatEth(circle.contribution)} ETH</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Slots</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">
                          {circle.slotsFilled}/{circle.maxMembers}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-slate-500">Round</dt>
                        <dd className="mt-0.5 font-medium text-slate-100">{formatDuration(circle.roundDuration)}</dd>
                      </div>
                    </dl>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
