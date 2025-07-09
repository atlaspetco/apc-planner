import { useState, useEffect } from "react";

interface CustomToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function CustomToggle({ checked, onCheckedChange, disabled = false, id }: CustomToggleProps) {
  const [isOn, setIsOn] = useState(checked);

  useEffect(() => {
    setIsOn(checked);
  }, [checked]);

  const handleClick = () => {
    if (disabled) return;
    const newState = !isOn;
    setIsOn(newState);
    onCheckedChange(newState);
  };

  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={isOn}
      disabled={disabled}
      onClick={handleClick}
      className={`
        relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${isOn ? 'bg-blue-600' : 'bg-gray-200'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 
          transition duration-200 ease-in-out
          ${isOn ? 'translate-x-5' : 'translate-x-0'}
        `}
      />
    </button>
  );
}