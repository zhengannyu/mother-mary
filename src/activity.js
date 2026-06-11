import "./activity.css";

// ── Intro sequence ──────────────────────────────────────────────
// Four phrases play one after another, then the curtain lifts and
// the page rises in. Edit INTRO_LINES to change the copy.
const INTRO_LINES = ["This is not a ghost story", "This is not a love story"];

const intro = document.querySelector(".intro");
const introLine = document.querySelector(".intro__line");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function playIntro() {
  if (!intro || !introLine || reduceMotion) {
    document.body.classList.add("intro-played");
    return;
  }

  let i = 0;

  function showNext() {
    if (i >= INTRO_LINES.length) {
      finish();
      return;
    }
    introLine.textContent = INTRO_LINES[i];
    introLine.classList.remove("is-in");
    void introLine.offsetWidth; // restart the animation
    introLine.classList.add("is-in");
    i += 1;
  }

  // Advance when each line's fade-out finishes
  introLine.addEventListener("animationend", showNext);

  function finish() {
    intro.classList.add("is-done");
    document.body.classList.add("intro-played");
  }

  showNext();
}

playIntro();

// Open the ticket form when the rotating button is tapped.
const scrollBtn = document.querySelector(".scroll-btn");
scrollBtn?.addEventListener("click", () => {
  window.open("https://tally.so/r/EkM8MA", "_blank", "noopener");
});
