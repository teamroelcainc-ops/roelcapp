import './Spinner.css';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label = 'Loading…' }: SpinnerProps) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner-circle" />
      <span className="spinner-label">{label}</span>
    </div>
  );
}
