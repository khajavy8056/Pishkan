import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ArrowUp } from 'lucide-react';
import clsx from 'clsx';

/**
 * Global "back to top" button, mounted once at the router root so it exists on
 * EVERY page (public, panels, and standalone auth pages alike).
 *
 * Behaviour:
 *  - Hidden at the top of the page; fades/slides in only after the user has
 *    scrolled down a little (>= 320px), so it never sits on a fresh page.
 *  - Smooth-scrolls back to the top on click.
 *  - Parks directly ABOVE the chat FAB. Public pages keep the chat in the
 *    bottom-left corner, so the button sits bottom-left there; inside the
 *    panels the chat lives beside the right sidebar, so the button matches it.
 *  - Steps aside while the chat panel is open (body[data-chat-open]) so the two
 *    never overlap — see ChatWidget.
 */
export function ScrollTopButton() {
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    const update = () => {
      ticking = false;
      setVisible(window.scrollY > 320);
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [pathname]);

  // Panel routes keep the chat (and therefore this button) on the right, beside
  // the 17.5rem sidebar; everything else uses the bottom-left corner.
  const isPanel = /^\/(app|staff|admin)(\/|$)/.test(pathname);
  const position = isPanel
    ? 'bottom-36 right-4 lg:bottom-[5.75rem] lg:right-[19rem]'
    : 'bottom-36 left-4 lg:bottom-[5.75rem] lg:left-6';

  return (
    <button
      type="button"
      aria-label="بازگشت به بالای صفحه"
      title="بازگشت به بالا"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      className={clsx(
        'scroll-top-fab fixed z-40 grid size-11 place-items-center rounded-full',
        'border border-line bg-surface/90 text-brand-700 shadow-xl ring-1 ring-black/5 backdrop-blur-md',
        'transition-all duration-300 hover:-translate-y-0.5 hover:bg-brand-600 hover:text-white hover:shadow-2xl',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
        position,
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
      )}
    >
      <ArrowUp className="size-5" strokeWidth={2.5} />
    </button>
  );
}
