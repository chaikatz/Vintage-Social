import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Whether the phone has a connection, as NetInfo reads its own link. The
 * room makes no request of its own; it only needs to know, so a print
 * whose preview is still in iCloud can say it is waiting for the phone to
 * be online, and try again when it is, and so DOWNLOAD AND DEVELOP can be
 * offered again once a connection is back. Until NetInfo answers, the
 * phone is taken to be online.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let live = true;
    let unsubscribe: (() => void) | null = null;
    try {
      unsubscribe = NetInfo.addEventListener((state) => {
        if (live) setOnline(state.isConnected !== false);
      });
    } catch {
      unsubscribe = null;
    }
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, []);
  return online;
}
