import React, { useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

let mermaidLoader: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  if (!mermaidLoader) {
    mermaidLoader = import("mermaid");
  }
  return mermaidLoader;
}

let highlightLoader: Promise<typeof import("./codeHighlight.ts")> | null = null;
function loadHighlighter() {
  if (!highlightLoader) {
    highlightLoader = import("./codeHighlight.ts");
  }
  return highlightLoader;
}

function MermaidBlock({ chart }: { chart: string }) {
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string | null>(null);
  const [themeMode, setThemeMode] = useState<"dark" | "light">(() =>
    document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );
  const mounted = useRef(true);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next =
        document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
      setThemeMode(next);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);

    const renderId = `mmd-${rawId}-${Math.random().toString(36).slice(2, 7)}`;
    loadMermaid()
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: themeMode === "light" ? "default" : "dark",
          securityLevel: "strict",
        });
        return mermaid.render(renderId, chart.trim());
      })
      .then((res) => {
        if (mounted.current) {
          setSvg(res.svg);
          setErr(null);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted.current) {
          setErr((e as Error).message || "Diagram render error");
          setLoading(false);
        }
      });

    return () => {
      mounted.current = false;
    };
  }, [chart, rawId, themeMode]);

  if (err) {
    return (
      <pre className="mermaid-fallback">
        <code>{chart}</code>
      </pre>
    );
  }
  if (loading && !svg) {
    return <div className="mermaid-diagram muted">Diaqram yüklənir...</div>;
  }
  return (
    <div
      className="mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function HighlightedCode({
  code,
  lang,
  className,
}: {
  code: string;
  lang: string;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadHighlighter().then(({ highlightCode }) => {
      if (!active) return;
      setHtml(highlightCode(code, lang));
    });
    return () => {
      active = false;
    };
  }, [code, lang]);

  if (html !== null) {
    return (
      <code
        className={`hljs ${className ?? ""}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <code className={className}>{code}</code>;
}

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const lang = match?.[1]?.toLowerCase();
            const text = String(children ?? "").replace(/\n$/, "");
            if (lang === "mermaid") {
              return <MermaidBlock chart={text} />;
            }
            if (lang) {
              return <HighlightedCode code={text} lang={lang} className={className} />;
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
