import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPlayer, type Player } from "./api";

export function NicknameDialog({ onDone, onClose }: { onDone: (p: Player) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await createPlayer(name));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="nick-title" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <header>
          <h2 id="nick-title">Choose a nickname</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <p>This is how you'll appear on the Lantern Cup leaderboard. No email or password needed.</p>
        <label className="field-label" htmlFor="nickname">Nickname</label>
        <input id="nickname" ref={input} className="text-input" value={name} maxLength={20} autoComplete="nickname"
          placeholder="e.g. Custard King" onChange={(e) => setName(e.target.value)} />
        <p className="small muted">3 to 20 letters, numbers, spaces, - or _. Keep it friendly.</p>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button type="submit" className="primary wide" disabled={busy || name.trim().length < 3}>{busy ? "Saving…" : "Save nickname"}</button>
        <p className="small muted">A private key is saved in this browser so the server knows it's you. If you clear your browser data you'll need a new nickname.</p>
      </form>
    </div>
  );
}
