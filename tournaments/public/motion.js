const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function play(element, keyframes, duration) {
  if (!reducedMotion.matches && element.animate) {
    element.animate(keyframes, { duration, easing: 'cubic-bezier(.2,.7,.25,1)' });
  }
}

export function enterScreen(element) {
  for (const animation of element.getAnimations?.() ?? []) animation.cancel();
  play(element, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], 210);
}

export function updateDigits(element, value) {
  if (element.textContent === value) return;
  const characters = [...value];
  if (element.childElementCount !== characters.length) {
    element.replaceChildren(...characters.map((character) => {
      const digit = document.createElement('span');
      digit.className = 'clock-digit';
      digit.textContent = character;
      return digit;
    }));
    return;
  }
  characters.forEach((character, index) => {
    const digit = element.children[index];
    if (digit.textContent === character) return;
    digit.textContent = character;
    for (const animation of digit.getAnimations?.() ?? []) animation.cancel();
    play(digit, [{ opacity: .35, transform: 'translateY(.28em)' }, { opacity: 1, transform: 'none' }], 180);
  });
}
