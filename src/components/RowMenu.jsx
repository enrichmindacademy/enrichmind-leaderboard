import { useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

// A compact "..." menu for secondary row actions — keeps a roster row from
// turning into a wall of buttons. `items` is an array of
// { label, onClick, disabled?, danger? }.
export default function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button className="row-menu-trigger" onClick={() => setOpen((v) => !v)} title="More actions">
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="row-menu-panel">
          {items.map((item, i) => (
            <button
              key={i}
              className={`row-menu-item ${item.danger ? "danger" : ""}`}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
