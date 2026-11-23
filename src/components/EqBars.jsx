// Three bouncing bars beside the play button of the preview that is playing.
// Decorative: the button itself already says play or pause.
export default function EqBars({ color }) {
  return (
    <span className="vv-eq" aria-hidden="true" style={{ color }}>
      <span /><span /><span />
    </span>
  );
}
