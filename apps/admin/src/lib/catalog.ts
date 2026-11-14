import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch, post, put } from './api.ts';

export interface Category { id: string; slug: string; name: string; sort: number; imageId: string | null }
export interface Collection { id: string; slug: string; name: string; kind: 'collection' | 'occasion'; description: string; sort: number; imageId: string | null; active: number }
export interface Presets { colours: { label: string; hex: string }[]; sizes: string[]; fabrics: string[] }

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => get<Category[]>('/admin/categories') });
export const useCollections = () => useQuery({ queryKey: ['collections'], queryFn: () => get<Collection[]>('/admin/collections') });
export const usePresets = () => useQuery({ queryKey: ['catalog-presets'], queryFn: () => get<Presets>('/admin/catalog/presets'), staleTime: 60_000 });

/** Create / update helpers that keep every picker in Admin in sync. */
export function useCatalogMutations() {
  const qc = useQueryClient();
  const createCategory = useMutation({
    mutationFn: (b: { name: string }) => post<Category>('/admin/categories', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const updateCategory = useMutation({
    mutationFn: ({ id, ...b }: { id: string; name?: string; imageId?: string | null; sort?: number }) => patch<Category>(`/admin/categories/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const createCollection = useMutation({
    mutationFn: (b: { name: string; kind?: 'collection' | 'occasion'; description?: string }) => post<Collection>('/admin/collections', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
  const updateCollection = useMutation({
    mutationFn: ({ id, ...b }: { id: string; name?: string; kind?: 'collection' | 'occasion'; description?: string; imageId?: string | null; active?: boolean }) => patch<Collection>(`/admin/collections/${id}`, b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collections'] }),
  });
  const savePresets = useMutation({
    mutationFn: (p: Presets) => put<Presets>('/admin/catalog/presets', p),
    onSuccess: (p) => qc.setQueryData(['catalog-presets'], p),
  });
  return { createCategory, updateCategory, createCollection, updateCollection, savePresets };
}

export const slugValue = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
