/** Единая точка «сейчас» — тесты подменяют время */
let override: Date | null = null;

export const clock = {
  now: (): Date => (override ? new Date(override) : new Date()),
  set: (d: Date | string | null) => {
    override = d === null ? null : new Date(d);
  },
};
