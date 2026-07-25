import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isLoading?: boolean;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isLoading = false
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--app-panel)] rounded-xl border border-[var(--app-border-soft)] p-6 max-w-md w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-bold text-[var(--app-text)] mb-2">{title}</h3>
        <p className="text-sm text-[var(--app-muted)] mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--app-panel)] text-[var(--app-muted)] hover:text-[var(--app-text)] border border-[var(--app-border)] transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-[var(--app-blue)] text-white hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {isLoading ? '⏳ Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LoadingSpinner() {
  return (
    <div className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
  );
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  isLoading = false,
  error = false
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  isLoading?: boolean;
  error?: boolean;
}) {
  return (
    <div className={`bg-[var(--app-panel)] rounded-xl border border-[var(--app-border-soft)] p-4 ${error ? 'border-red-500/30' : ''}`}>
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-semibold text-[var(--app-blue)] mb-1">{title}</h4>
        {icon}
      </div>
      <div className={`text-xl font-mono font-bold ${error ? 'text-red-400' : 'text-[var(--app-text)]'} mb-1`}>
        {isLoading ? '... loading...' : value}
      </div>
      {subtitle && <div className="text-xs text-[var(--app-muted)]">{subtitle}</div>}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  children,
  action,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-[var(--app-panel)] rounded-xl border border-[var(--app-border-soft)] p-6 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-[var(--app-text)] mb-1">{title}</h3>
          {subtitle && <p className="text-sm text-[var(--app-muted)]">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function InputGroup({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  disabled = false,
  error = false,
  className: _className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm text-[var(--app-muted)] w-32 shrink-0 font-medium">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`flex-1 bg-[var(--app-bg)] border ${error ? 'border-red-500/50' : 'border-[var(--app-border)]'} rounded-lg px-3 py-2 text-sm font-mono text-[var(--app-text)] disabled:opacity-50 transition-colors`}
      />
    </div>
  );
}

export function Button({
  onClick,
  label,
  variant = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  icon,
  className = '',
}: {
  onClick: () => void;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  busy?: boolean;
  icon?: React.ReactNode;
  className?: string;
}) {
  const baseClasses = 'rounded-lg font-semibold transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2 justify-center';
  const variantClasses = {
    primary: 'bg-[var(--app-blue)] text-white hover:opacity-80 shadow-md hover:shadow-lg',
    secondary: 'bg-[var(--app-panel)] text-[var(--app-muted)] hover:text-[var(--app-text)] border border-[var(--app-border-soft)] hover:border-[var(--app-border)]',
    danger: 'bg-[var(--app-danger)] text-white hover:opacity-80 shadow-md hover:shadow-lg',
    success: 'bg-[var(--app-success)] text-white hover:opacity-80 shadow-md hover:shadow-lg',
  };
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
    >
      {busy && <LoadingSpinner />}
      {icon && !busy && icon}
      {label}
    </button>
  );
}
