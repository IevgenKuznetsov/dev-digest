import React from "react";
import ReactDOM from "react-dom";

/**
 * Lightweight hover tooltip. Renders via a portal so the floating panel
 * escapes any `overflow: hidden` ancestor (e.g. the PR list table card).
 *
 * Enter/leave delays prevent flicker when the cursor passes over a badge
 * without intent to inspect.
 */
export function Tooltip({
  trigger,
  children,
  width = 340,
  align = "left",
  disabled,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  align?: "left" | "center" | "right";
  disabled?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  const enterTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const leaveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; flipAbove: boolean }>({
    top: 0,
    left: 0,
    flipAbove: false,
  });

  const show = () => {
    if (leaveTimer.current) {
      clearTimeout(leaveTimer.current);
      leaveTimer.current = null;
    }
    enterTimer.current = setTimeout(() => {
      if (wrapRef.current) {
        const rect = wrapRef.current.getBoundingClientRect();
        const flipAbove = rect.bottom + 320 > window.innerHeight;
        let left = rect.left;
        if (align === "center") left = rect.left + rect.width / 2 - width / 2;
        else if (align === "right") left = rect.right - width;
        // Clamp to viewport
        left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
        setPos({
          top: flipAbove ? rect.top + window.scrollY : rect.bottom + window.scrollY,
          left: left + window.scrollX,
          flipAbove,
        });
      }
      setVisible(true);
    }, 150);
  };

  const hide = () => {
    if (enterTimer.current) {
      clearTimeout(enterTimer.current);
      enterTimer.current = null;
    }
    leaveTimer.current = setTimeout(() => setVisible(false), 100);
  };

  React.useEffect(() => {
    return () => {
      if (enterTimer.current) clearTimeout(enterTimer.current);
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
    };
  }, []);

  if (disabled) return <>{trigger}</>;

  return (
    <div
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{ position: "relative", display: "inline-block" }}
    >
      {trigger}
      {visible &&
        ReactDOM.createPortal(
          <div
            onMouseEnter={show}
            onMouseLeave={hide}
            style={{
              position: "absolute",
              top: pos.flipAbove ? undefined : pos.top + 6,
              bottom: pos.flipAbove
                ? document.documentElement.scrollHeight - pos.top + 6
                : undefined,
              left: pos.left,
              width,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: 9,
              boxShadow: "var(--shadow-modal)",
              padding: 10,
              zIndex: 50,
              maxHeight: 320,
              overflowY: "auto",
              animation: "ddpop .12s ease",
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
