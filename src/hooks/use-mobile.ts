import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(cb: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", cb)
  return () => mql.removeEventListener("change", cb)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}

/**
 * useIsMobile for a value that feeds a context over the whole page. It starts as the server's answer and
 * takes the phone's in a transition after hydration: a plain update would reach parts of the page that are still
 * waiting to hydrate, and React would throw their server HTML away and show their skeletons until their code arrives.
 */
export function useIsMobileAfterHydration() {
  const [mobile, setMobile] = React.useState(false)
  React.useEffect(() => {
    const read = () => setMobile(window.matchMedia(QUERY).matches)
    React.startTransition(read)
    return subscribe(read)
  }, [])
  return mobile
}
