import { useState } from "react";

// A screenshot input that accepts a pasted image (Ctrl+V, e.g. from the
// Windows Snipping Tool / Win+Shift+S, which copies straight to the
// clipboard with nothing to save first), a dropped file, or a normal file
// picker as a fallback. `file` is the current File/Blob or null; `onChange`
// receives the new one (or null to clear).
export default function PasteZone({ label, file, onChange }) {
  const [dragOver, setDragOver] = useState(false);

  function handlePaste(e) {
    const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
    if (item) {
      e.preventDefault();
      onChange(item.getAsFile());
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []).find((f) => f.type.startsWith("image/"));
    if (dropped) onChange(dropped);
  }

  return (
    <div>
      {label && (
        <>
          <label className="muted" style={{ fontSize: 12 }}>{label}</label>
          <br />
        </>
      )}
      <div
        tabIndex={0}
        onPaste={handlePaste}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        className="paste-zone"
        style={dragOver ? { borderColor: "rgba(139,138,219,.7)", background: "rgba(139,138,219,.06)" } : undefined}
      >
        {file ? (
          <span className="row" style={{ gap: 8 }}>
            📎 {file.name || "Pasted image"}
            <button
              type="button"
              className="btn secondary"
              style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
            >
              ✕
            </button>
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 12 }}>
            <strong>Ctrl+V</strong> or{" "}
            <label style={{ textDecoration: "underline", cursor: "pointer" }}>
              choose file
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => onChange(e.target.files[0])}
              />
            </label>
          </span>
        )}
      </div>
    </div>
  );
}
