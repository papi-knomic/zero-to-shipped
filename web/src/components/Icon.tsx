// A handful of 24px stroke icons, inline so there's no icon-library dependency.
const PATHS = {
  upload: 'M12 15V4m0 0L8 8m4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4',
  check: 'M5 12.5 10 17.5 19 7',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  alert: 'M12 9v4m0 3.5h.01M10.3 3.9 2.4 17.6a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  chevron: 'm9 6 6 6-6 6',
  back: 'M19 12H5m0 0 6-6m-6 6 6 6',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9Zm4.3 13a2 2 0 0 0 3.4 0',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  stack: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  x: 'M18 6 6 18M6 6l12 12',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6m6-10h4v4c0 3-1.5 5-4 6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The Lapse mark: a document with its key line highlighted. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="logo-mark">
      <rect width="32" height="32" rx="8" fill="#0b6e4f" />
      <path d="M11 7.5h7.2l4.8 4.8V23a1.5 1.5 0 0 1-1.5 1.5H11A1.5 1.5 0 0 1 9.5 23V9A1.5 1.5 0 0 1 11 7.5Z" fill="#fffcf6" />
      <path d="M18.2 7.5v4.8H23Z" fill="#bfe0cf" />
      <rect x="11.6" y="15.6" width="9" height="3.2" rx="1" fill="#f6d84a" />
      <rect x="11.6" y="20.4" width="6" height="1.5" rx="0.7" fill="#0b6e4f" opacity="0.45" />
    </svg>
  );
}
