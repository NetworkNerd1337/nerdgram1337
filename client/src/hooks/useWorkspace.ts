import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { bookmarkPaths, EMPTY_BOOKMARKS, type BookmarkState } from "../lib/bookmarks";
import type { TreeNode } from "../types";

export function useWorkspace() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkState>(EMPTY_BOOKMARKS);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [treeRes, bookRes] = await Promise.all([api.tree(), api.bookmarks()]);
      setTree(treeRes.tree);
      setBookmarks(bookRes);
      setRevision((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleFavorite = useCallback(async (path: string) => {
    const result = await api.toggleFavorite(path);
    if (result.bookmarks) setBookmarks(result.bookmarks);
    return result.favorited;
  }, []);

  const saveBookmarks = useCallback(async (next: BookmarkState) => {
    const saved = await api.setBookmarks(next);
    setBookmarks(saved);
    return saved;
  }, []);

  return {
    tree,
    bookmarks,
    favorites: bookmarkPaths(bookmarks),
    revision,
    loading,
    error,
    refresh,
    toggleFavorite,
    saveBookmarks,
  };
}
