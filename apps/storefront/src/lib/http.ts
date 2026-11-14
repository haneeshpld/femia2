/** Typed Response.json() (Workers types return unknown). */
export const json = <T>(r: Response): Promise<T> => r.json() as Promise<T>;
