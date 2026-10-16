import { useLayoutEffect, useRef } from 'preact/hooks';

/** Keep floating canvas controls clear when their content wraps or is hidden. */
export function useChromeHeight(property: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const region = element?.parentElement;
    if (!element || !region) return;
    const measure = () => region.style.setProperty(property, `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      region.style.removeProperty(property);
    };
  }, [property]);
  return ref;
}
