import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        maxWidth: "38rem",
        margin: "0 auto",
        padding: "calc(var(--safe-top) + 4rem) 1.25rem 4rem",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "0.72rem",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-2)",
          margin: 0,
        }}
      >
        404
      </p>
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 400,
          fontSize: "clamp(2.4rem, 10vw, 4rem)",
          lineHeight: 1,
          margin: "0.5rem 0 1rem",
        }}
      >
        {/* The margin-note rule from the site icon, standing in front of the heading. */}
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: "0.14em",
            height: "0.78em",
            marginRight: "0.32em",
            background: "var(--accent-2)",
          }}
        />
        Nothing here.
      </h1>
      <p style={{ color: "var(--ink-2)" }}>
        That page doesn&rsquo;t exist, or hasn&rsquo;t been published yet. <Link href="/">Back to the index</Link>.
      </p>
    </main>
  );
}
