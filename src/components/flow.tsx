import { Children, type CSSProperties, type ReactNode } from "react";

const LINE = "bg-gold/50";

/** A step in the flow: numbered, and revealed once the step before it is done. */
export function FlowNode({
  step,
  title,
  hint,
  wide = false,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  /** Span the width of the item pickers instead of the narrow step column. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={`animate-pop mx-auto w-full ${wide ? "max-w-5xl" : "max-w-2xl"} rounded-xl border border-gold/40 bg-panel p-5 shadow-lg shadow-black/30`}
    >
      <header className="mb-4 flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-ink">
          {step}
        </span>
        <div>
          <h2 className="text-lg font-semibold leading-tight">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
      </header>
      {children}
    </section>
  );
}

/** A line with an arrowhead pointing at the next node. */
export function Connector() {
  return (
    <div aria-hidden className="animate-pop mx-auto flex h-10 flex-col items-center">
      <div className={`w-px flex-1 ${LINE}`} />
      <div className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-gold/70" />
    </div>
  );
}

/**
 * A connector whose arrowhead lands `shift` right of centre on wide screens,
 * for a next node that sits off-centre beside a side column. Straight when the layout stacks.
 */
export function ElbowConnector({ shift }: { shift: string }) {
  return (
    <>
      <div className="lg:hidden">
        <Connector />
      </div>
      <div aria-hidden className="animate-pop relative hidden h-10 lg:block">
        <div className={`absolute left-1/2 top-0 h-1/2 w-px ${LINE}`} />
        <div className={`absolute left-1/2 top-1/2 h-px ${LINE}`} style={{ width: shift }} />
        <div
          className="absolute top-1/2 flex h-1/2 -translate-x-1/2 flex-col items-center"
          style={{ left: `calc(50% + ${shift} + 0.5px)` }}
        >
          <div className={`w-px flex-1 ${LINE}`} />
          <div className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-gold/70" />
        </div>
      </div>
    </>
  );
}

/** Points right at the next node on wide screens, down when the layout stacks. */
export function SideArrow() {
  return (
    <div aria-hidden className="flex shrink-0 items-center">
      <div className="flex h-8 flex-col items-center lg:hidden">
        <div className={`w-px flex-1 ${LINE}`} />
        <div className="h-0 w-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-gold/70" />
      </div>
      <div className="hidden w-10 items-center lg:flex">
        <div className={`h-px flex-1 ${LINE}`} />
        <div className="h-0 w-0 border-y-[5px] border-l-[7px] border-y-transparent border-l-gold/70" />
      </div>
    </div>
  );
}

/**
 * One parent splitting into several children, like an org chart. The bars only
 * draw on wide screens; on narrow ones the children simply stack.
 */
export function Branch({ children }: { children: ReactNode }) {
  const items = Children.toArray(children);
  const n = items.length;
  const gap = 1; // rem, matches gap-4
  const inset = `calc((100% - ${(n - 1) * gap}rem) / ${2 * n})`;
  return (
    <div className="animate-pop">
      <div aria-hidden className={`mx-auto h-6 w-px ${LINE}`} />
      <div
        className="relative grid gap-4 md:grid-cols-[repeat(var(--n),minmax(0,1fr))] md:pt-6"
        style={{ "--n": n } as CSSProperties}
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute top-0 hidden h-px md:block ${LINE}`}
          style={{ left: inset, right: inset }}
        />
        {items.map((child, i) => (
          <div
            key={i}
            className={`relative min-w-0 md:before:absolute md:before:-top-6 md:before:left-1/2 md:before:h-6 md:before:w-px md:before:content-[''] md:before:bg-gold/50`}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Side-by-side nodes whose lines drop from the middle of each, join, and arrow into
 * the next node at page centre. Lines only draw once `into` is set, i.e. the next node
 * is showing. When the layout stacks, a single straight connector follows the last node.
 */
export function Merge({ into, children }: { into: boolean; children: ReactNode }) {
  const items = Children.toArray(children);
  const n = items.length;
  const gap = 1; // rem, matches gap-4
  const inset = `calc((100% - ${(n - 1) * gap}rem) / ${2 * n})`;
  return (
    <div className="mx-auto max-w-5xl">
      <div
        className="grid gap-4 lg:grid-cols-[repeat(var(--n),minmax(0,1fr))]"
        style={{ "--n": n } as CSSProperties}
      >
        {/* Columns stretch to the tallest node, so each drop line reaches the same bar. */}
        {items.map((child, i) => (
          <div key={i} className="flex min-w-0 flex-col">
            {child}
            {into && <div aria-hidden className={`animate-pop mx-auto hidden min-h-5 w-px flex-1 lg:block ${LINE}`} />}
          </div>
        ))}
      </div>
      {into && (
        <>
          <div aria-hidden className="animate-pop relative hidden h-px lg:block">
            <span className={`absolute inset-y-0 ${LINE}`} style={{ left: inset, right: inset }} />
          </div>
          <Connector />
        </>
      )}
    </div>
  );
}

/** Small label sitting on the flow between two sections. */
export function FlowLabel({ children }: { children: ReactNode }) {
  return (
    <p className="animate-pop mx-auto w-fit rounded-full border border-gold/40 bg-panel px-4 py-1 text-xs font-semibold uppercase tracking-wider text-gold">
      {children}
    </p>
  );
}
