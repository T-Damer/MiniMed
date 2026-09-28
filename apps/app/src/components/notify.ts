import { toast } from 'solid-sonner';

/**
 * A success notice about something the user now has (downloaded, added, created) with one
 * link-styled way to open exactly that item, instead of leaving them to find it.
 */
export function notifyWithOpen(
  message: string,
  open: () => void,
  options: { readonly id?: string | number; readonly label?: string } = {},
): string | number {
  return toast.success(message, {
    ...(options.id === undefined ? {} : { id: options.id }),
    action: { label: options.label ?? 'Открыть', onClick: open },
  });
}
