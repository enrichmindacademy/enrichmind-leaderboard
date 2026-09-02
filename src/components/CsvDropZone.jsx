import { useState } from "react";

// A CSV file input for a real export (IXL Score Grid, Kuta Works results,
// Formative export) -- drag/drop or a normal file picker. No clipboard
// paste here (CSVs aren't screenshotted), otherwise styled the same as
// PasteZone so the two input types sit together without looking like two
// different apps.
export default function CsvDropZone({ label, file, onChange }) {
  const [dragOver, setDragOver] = useState(false);

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []).find(
      (f) => f.type === "text/csv" || f.name?.toLowerCase().endsWith(".csv")
    );
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
            📄 {file.name}
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
            Drop .csv or{" "}
            <label style={{ textDecoration: "underline", cursor: "pointer" }}>
              choose file
              <input
                type="file"
                accept=".csv,text/csv"
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
