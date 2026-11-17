import type { TreeNode } from "../types";

export type TemplateCardFields = {
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  category: string;
  diagramType: string;
};

export type TemplateFilters = {
  query?: string;
  category?: string;
  diagramType?: string;
  tag?: string;
};

/** Case-insensitive unique labels, sorted for filter menus. */
export function uniqueSorted(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  return out;
}

/**
 * Gallery search. The query matches the name, description, tags, category,
 * diagram type, and id. Category, type, and tag filters are exact (ignoring
 * case) and stack with the query.
 */
export function filterTemplates<T extends TemplateCardFields>(
  templates: readonly T[],
  filters: TemplateFilters,
): T[] {
  const needle = filters.query?.trim().toLowerCase() ?? "";
  const category = filters.category?.trim().toLowerCase() ?? "";
  const diagramType = filters.diagramType?.trim().toLowerCase() ?? "";
  const tag = filters.tag?.trim().toLowerCase() ?? "";
  return templates.filter((template) => {
    if (category && template.category.trim().toLowerCase() !== category) return false;
    if (diagramType && template.diagramType.trim().toLowerCase() !== diagramType) return false;
    if (tag && !template.tags.some((item) => item.trim().toLowerCase() === tag)) return false;
    if (!needle) return true;
    const haystack = [
      template.title,
      template.description,
      template.category,
      template.diagramType,
      template.id,
      ...template.tags,
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
}

export function folderInTree(nodes: readonly TreeNode[], target: string): boolean {
  if (!target) return true;
  const walk = (list: readonly TreeNode[]): boolean => {
    for (const node of list) {
      if (node.type === "folder" && node.path === target) return true;
      if (node.children && walk(node.children)) return true;
    }
    return false;
  };
  return walk(nodes);
}

export function templatePresentHref(id: string): string {
  return `/templates/present/${encodeURIComponent(id)}`;
}

export function templateEditHref(id: string): string {
  return `/templates/edit/${encodeURIComponent(id)}`;
}

/** Gallery sections. Every category is listed even when it has no templates. */
export const TEMPLATE_CATEGORIES = [
  "Network",
  "Software",
  "Internet & Cloud",
  "Security",
  "OT & Industrial",
  "Data Center",
  "Operations & Planning",
  "User created",
] as const;

export type TemplateSection<T> = {
  category: string;
  templates: T[];
};

/**
 * Group templates into the fixed category order. With no search and no
 * filters, every category is present, including empty ones. While a search
 * or filter is active, sections with no matches are left out.
 */
export function groupTemplateSections<T extends TemplateCardFields>(
  templates: readonly T[],
  filters: TemplateFilters,
): TemplateSection<T>[] {
  const narrowing = Boolean(filters.query?.trim() || filters.diagramType?.trim() || filters.tag?.trim());
  const shown = filterTemplates(templates, filters);
  const wanted = filters.category?.trim();
  const categories = wanted
    ? TEMPLATE_CATEGORIES.filter((name) => name.toLowerCase() === wanted.toLowerCase())
    : [...TEMPLATE_CATEGORIES];
  const sections: TemplateSection<T>[] = categories.map((category) => ({
    category,
    templates: shown.filter((item) => item.category.trim().toLowerCase() === category.toLowerCase()),
  }));
  const known = new Set(TEMPLATE_CATEGORIES.map((name) => name.toLowerCase()));
  if (!wanted) {
    const extras = uniqueSorted(
      shown.map((item) => item.category).filter((name) => !known.has(name.trim().toLowerCase())),
    );
    for (const category of extras) {
      sections.push({
        category,
        templates: shown.filter((item) => item.category.trim().toLowerCase() === category.toLowerCase()),
      });
    }
  }
  if (!narrowing) return sections;
  return sections.filter((section) => section.templates.length > 0);
}
