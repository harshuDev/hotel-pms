/** The marks a rate plan carries in Room Rate Combinations and on the Channex card. */

export function PersonIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="5" r="2.6" />
      <path d="M3 14c.5-3 2.5-4.5 5-4.5s4.5 1.5 5 4.5" strokeLinecap="round" />
    </svg>
  );
}

export function ChildIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="6" r="2.2" />
      <path d="M4.5 14c.4-2.3 1.8-3.5 3.5-3.5s3.1 1.2 3.5 3.5" strokeLinecap="round" />
    </svg>
  );
}

export function StarIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current" aria-hidden="true">
      <path d="M8 1.5l1.9 4.1 4.5.5-3.3 3 .9 4.4L8 11.3l-4 2.2.9-4.4-3.3-3 4.5-.5z" />
    </svg>
  );
}

export function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" aria-hidden="true">
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
      {off && <path d="M2.5 13.5l11-11" />}
    </svg>
  );
}
