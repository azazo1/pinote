import { Check } from "lucide-react";

export const noteColors = {
  lemon: { body: "#fff29a", bar: "#ffe977", ink: "#3f3b27" },
  mint: { body: "#cdeedc", bar: "#acdcbf", ink: "#263c30" },
  coral: { body: "#ffd2c8", bar: "#f4b5a8", ink: "#492f2a" },
  sky: { body: "#cfe7f5", bar: "#acd2e7", ink: "#263943" },
  paper: { body: "#f1eee6", bar: "#dcd7cc", ink: "#36342f" },
};

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="color-picker" role="menu" aria-label="便签颜色">
      {Object.entries(noteColors).map(([name, color]) => (
        <button
          key={name}
          type="button"
          className="color-swatch"
          style={{ background: color.body }}
          aria-label={name}
          onClick={() => onChange(name)}
        >
          {value === name && <Check size={15} strokeWidth={2.5} />}
        </button>
      ))}
    </div>
  );
}
