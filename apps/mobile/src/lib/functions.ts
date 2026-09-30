import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';

// Вызов Edge Function с понятной ошибкой из поля { error } ответа.
export async function invokeFunction<T>(name: string, body: object): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const details = await error.context.json().catch(() => null);
      throw new Error(details?.error ?? error.message);
    }
    throw error;
  }
  return data as T;
}
