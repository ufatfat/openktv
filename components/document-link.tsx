import type { ComponentPropsWithoutRef } from "react";

type DocumentLinkProps = ComponentPropsWithoutRef<"a">;

/**
 * Navigates between OpenKTV's independent top-level surfaces with a full
 * document request. Vinext beta's client RSC link shim currently emits broken
 * minified exports in production builds, so next/link cannot safely be used
 * for these transitions.
 */
export function DocumentLink(props: DocumentLinkProps) {
  return <a {...props} />;
}
