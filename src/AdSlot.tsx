import { useEffect, useRef } from "react";

// Google AdSense, switched on by build-time settings (see README):
//   VITE_ADSENSE_CLIENT  e.g. ca-pub-1234567890123456
//   VITE_AD_SLOT_RESULT  ad unit shown under the results
//   VITE_AD_SLOT_FOOTER  ad unit at the bottom of the page
// Without them nothing is loaded; in development a placeholder shows where the ad would go.
// Consent for UK/EEA visitors is handled by Google's own consent message, enabled in AdSense.

const CLIENT = import.meta.env.VITE_ADSENSE_CLIENT;
export const AD_SLOTS = {
  result: import.meta.env.VITE_AD_SLOT_RESULT,
  footer: import.meta.env.VITE_AD_SLOT_FOOTER,
};

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

let scriptAdded = false;
function addScript(client: string) {
  if (scriptAdded) return;
  scriptAdded = true;
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

export function AdSlot({ slot, name }: { slot?: string; name: string }) {
  const ref = useRef<HTMLModElement>(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (!CLIENT || !slot || pushed.current) return;
    addScript(CLIENT);
    pushed.current = true; // each <ins> may only be filled once (React dev mode runs effects twice)
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* ad blockers or a not-yet-approved site: leave the space empty */
    }
  }, [slot]);

  if (!CLIENT || !slot) {
    return import.meta.env.DEV ? <div className="ad-placeholder" aria-hidden="true">Ad space: {name}</div> : null;
  }
  return (
    <aside className="ad" aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      <ins ref={ref} className="adsbygoogle" style={{ display: "block" }} data-ad-client={CLIENT} data-ad-slot={slot}
        data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
