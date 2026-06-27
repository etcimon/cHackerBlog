"use client";

/**
 * Code block component with expand/collapse functionality.
 * Used for displaying code blocks with optional line preview.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  code: string;
  language: string;
  previewLines?: number;
  highlighted?: string;
  highlightedPreview?: string;
}

export function CodeBlock({
  code,
  language,
  previewLines,
  highlighted,
  highlightedPreview,
}: Props) {
  const [isCollapsed, setIsCollapsed] = useState(
    previewLines ? code.split("\n").length > previewLines : false
  );

  const lines = code.split("\n");
  const hasPreview = previewLines && lines.length > previewLines;

  if (!hasPreview) {
    // No preview needed, show full code
    return (
      <pre>
        <code className={`hljs language-${language}`}>
          {highlighted || code}
        </code>
      </pre>
    );
  }

  return (
    <div className="code-block-wrapper">
      {isCollapsed ? (
        <pre>
          <code className={`hljs language-${language}`}>
            {highlightedPreview || lines.slice(0, previewLines).join("\n")}
            {"\n..."}
          </code>
        </pre>
      ) : (
        <pre>
          <code className={`hljs language-${language}`}>
            {highlighted || code}
          </code>
        </pre>
      )}

      {hasPreview && (
        <button
          className="code-expand-btn"
          onClick={() => setIsCollapsed(!isCollapsed)}
          type="button"
        >
          <span className="icon">
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </span>
          <span className="text">
            {isCollapsed ? `Show all ${lines.length} lines` : "Show less"}
          </span>
        </button>
      )}
    </div>
  );
}
