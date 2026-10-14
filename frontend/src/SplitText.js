/**
 * SplitText - Vanilla JS character animation inspired by React Bits
 * Splits text into individual character spans and animates them with staggered entrance.
 */
export function createSplitText(element, options = {}) {
  const {
    text = element.textContent.trim(),
    delay = 45, // ms stagger per char
    duration = 1.1, // seconds
    ease = 'cubic-bezier(0.16, 1, 0.3, 1)', // power3.out / smooth architectural entrance
    from = { opacity: 0, y: 40 },
    to = { opacity: 1, y: 0 },
    onComplete = null,
  } = options;

  element.innerHTML = '';
  element.classList.add('split-parent');
  element.style.display = 'inline-block';
  element.style.overflow = 'hidden';

  const chars = [];
  const words = text.split(' ');

  words.forEach((word, wordIndex) => {
    const wordSpan = document.createElement('span');
    wordSpan.className = 'split-word';
    wordSpan.style.display = 'inline-block';
    wordSpan.style.whiteSpace = 'nowrap';

    for (const char of word) {
      const charSpan = document.createElement('span');
      charSpan.className = 'split-char';
      charSpan.textContent = char;
      charSpan.style.display = 'inline-block';
      charSpan.style.willChange = 'transform, opacity';
      charSpan.style.opacity = String(from.opacity ?? 0);
      charSpan.style.transform = `translateY(${from.y ?? 40}px)`;
      wordSpan.appendChild(charSpan);
      chars.push(charSpan);
    }

    element.appendChild(wordSpan);

    if (wordIndex < words.length - 1) {
      const space = document.createTextNode(' ');
      element.appendChild(space);
    }
  });

  let completedCount = 0;
  const animations = [];

  function play() {
    chars.forEach((charSpan, index) => {
      const anim = charSpan.animate(
        [
          { opacity: from.opacity ?? 0, transform: `translateY(${from.y ?? 40}px)` },
          { opacity: to.opacity ?? 1, transform: `translateY(${to.y ?? 0}px)` },
        ],
        {
          duration: duration * 1000,
          delay: index * delay,
          easing: ease,
          fill: 'forwards',
        }
      );

      anim.onfinish = () => {
        completedCount++;
        if (completedCount === chars.length && typeof onComplete === 'function') {
          onComplete();
        }
      };

      animations.push(anim);
    });
  }

  // Trigger when fonts are ready
  if (document.fonts?.ready) {
    document.fonts.ready.then(play);
  } else {
    requestAnimationFrame(play);
  }

  return {
    chars,
    revert() {
      animations.forEach(a => a.cancel());
      element.textContent = text;
      element.classList.remove('split-parent');
    },
  };
}
