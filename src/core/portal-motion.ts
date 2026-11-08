import { gsap } from 'gsap';

export function animatePortal(scope: HTMLElement, experience: 'welcome' | 'borrower' | 'admin'): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const media = gsap.matchMedia();
  media.add({
    reduceMotion: '(prefers-reduced-motion: reduce)',
    compact: '(max-width: 640px)',
  }, ({ conditions }) => {
    if (conditions?.['reduceMotion']) return;

    if (experience === 'welcome') {
      gsap.from('[data-motion="brand"]', {
        autoAlpha: 0,
        y: 16,
        duration: 0.48,
        ease: 'power2.out',
      });
      gsap.from('[data-motion="copy"]', {
        autoAlpha: 0,
        y: 18,
        duration: 0.55,
        delay: 0.08,
        stagger: 0.07,
        ease: 'power2.out',
      });
    } else {
      const targets = experience === 'admin'
        ? '.page-heading, .metric-card, .two-columns > *'
        : '.page-heading, .application-card, .two-columns > *';
      gsap.from(targets, {
        autoAlpha: 0,
        y: 18,
        duration: 0.48,
        stagger: 0.065,
        ease: 'power2.out',
        clearProps: 'transform',
      });
    }

    if (!conditions?.['compact']) {
      gsap.to('[data-ambient-float]', {
        y: -10,
        rotate: 4,
        duration: 4.2,
        repeat: -1,
        yoyo: true,
        stagger: 0.45,
        ease: 'sine.inOut',
      });
      gsap.to('[data-ambient-orbit]', {
        rotate: 360,
        duration: 44,
        repeat: -1,
        ease: 'none',
        transformOrigin: '50% 50%',
      });
    }
  }, scope);

  return () => media.revert();
}
