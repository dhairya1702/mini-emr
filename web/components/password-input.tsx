"use client";

import { Eye, EyeOff } from "lucide-react";
import { InputHTMLAttributes, useId, useState } from "react";

type PasswordInputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  wrapperClassName?: string;
  labelClassName?: string;
  inputClassName?: string;
  hint?: string;
};

export function PasswordInput({
  label,
  wrapperClassName = "block",
  labelClassName = "mb-2 block text-sm font-medium text-slate-700",
  inputClassName = "w-full rounded-2xl border border-sky-200 bg-sky-50/40 px-4 py-3 pr-12 text-slate-800 outline-none transition focus:border-sky-400",
  hint,
  id,
  ...inputProps
}: PasswordInputProps) {
  const generatedId = useId();
  const [isVisible, setIsVisible] = useState(false);
  const resolvedId = id || generatedId;

  return (
    <label className={wrapperClassName}>
      <span className={labelClassName}>{label}</span>
      {hint ? <span className="mb-2 block text-xs leading-5 text-slate-500">{hint}</span> : null}
      <div className="relative">
        <input
          {...inputProps}
          id={resolvedId}
          type={isVisible ? "text" : "password"}
          className={inputClassName}
        />
        <button
          type="button"
          aria-label={isVisible ? "Hide password" : "Show password"}
          aria-controls={resolvedId}
          onClick={() => setIsVisible((current) => !current)}
          className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
        >
          {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}
