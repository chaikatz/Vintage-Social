/**
 * A switch that is written as it is flipped, one write at a time.
 *
 * Settings' switches used to send each flip as soon as it was made. Two
 * flips in quick succession were two requests in flight together, and the
 * server kept whichever happened to land last: a member could turn Likes
 * off and Comments off and find Comments on again. A write the server
 * refused left the switch showing what was never saved.
 *
 * Here a flip only records what is wanted. One write is in flight at a
 * time; when it lands, the newest wish is written next, the ones between
 * are skipped, and `onSaved` hears the value only once nothing newer is
 * waiting. A refusal drops whatever was waiting and calls `onFailed`, so
 * the screen can put the switch back as the server has it and say so.
 */
export interface SettingWriter<T> {
  /** The value the member has just chosen. */
  set(value: T): void;
  /** True while a write is in flight or waiting. */
  readonly busy: boolean;
}

export function createSettingWriter<T>(opts: {
  write: (value: T) => Promise<void>;
  onSaved: (value: T) => void;
  onFailed: (err: unknown) => void;
}): SettingWriter<T> {
  let wanted: { value: T } | null = null;
  let running = false;

  async function pump(): Promise<void> {
    running = true;
    try {
      while (wanted) {
        const { value } = wanted;
        wanted = null;
        try {
          await opts.write(value);
        } catch (err) {
          wanted = null;
          opts.onFailed(err);
          return;
        }
        if (!wanted) opts.onSaved(value);
      }
    } finally {
      running = false;
    }
  }

  return {
    set(value: T) {
      wanted = { value };
      if (!running) void pump();
    },
    get busy() {
      return running || wanted !== null;
    },
  };
}
