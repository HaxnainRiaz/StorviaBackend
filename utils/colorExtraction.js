/**
 * Extract unique colors from imported storefront CSS for the visual editor palette.
 */

const COLOR_PATTERNS = [
    /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g,
    /rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+(?:\s*,\s*[\d.]+)?\s*\)/gi,
    /hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*[\d.]+%(?:\s*,\s*[\d.]+)?\s*\)/gi,
];

function normalizeHex(color) {
    if (!color) return '';
    const c = String(color).trim().toLowerCase();
    if (c.startsWith('#')) {
        if (c.length === 4) {
            return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`;
        }
        return c.slice(0, 7);
    }
    return c;
}

function extractColorsFromCss(css = '') {
    const found = new Map();
    for (const pattern of COLOR_PATTERNS) {
        const matches = String(css).match(pattern) || [];
        for (const raw of matches) {
            const hex = normalizeHex(raw);
            if (!hex || hex === '#000' || hex === '#fff' || hex === '#ffffff') continue;
            const key = hex;
            if (!found.has(key)) {
                found.set(key, { originalColor: raw, normalizedHex: hex, usageCount: 1 });
            } else {
                found.get(key).usageCount += 1;
            }
        }
    }
    return Array.from(found.values()).map((entry, i) => ({
        id: `color_${i}`,
        originalColor: entry.originalColor,
        currentColor: entry.originalColor,
        normalizedHex: entry.normalizedHex,
        source: 'css_rule',
        usageCount: entry.usageCount,
        editable: true,
    }));
}

function extractColorsFromSchema(schema) {
    const css = [
        schema?.scopedCss,
        schema?.globalStyles?.rawCss,
        ...(schema?.pages || []).flatMap((p) => (p.sections || []).map((s) => s.css || '')),
    ].filter(Boolean).join('\n');

    const fromCss = extractColorsFromCss(css);
    const globals = schema?.globalStyles?.colors || {};
    const tokens = [...fromCss];

    for (const [key, value] of Object.entries(globals)) {
        if (!value) continue;
        tokens.push({
            id: `global_${key}`,
            originalColor: value,
            currentColor: value,
            normalizedHex: normalizeHex(value) || value,
            source: 'css_variable',
            cssVariableName: key,
            usageCount: 1,
            editable: true,
            label: key,
        });
    }

    const seen = new Set();
    return tokens.filter((t) => {
        const k = t.normalizedHex || t.originalColor;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

function flattenEditableFields(schema) {
    const fields = [];
    for (const page of schema?.pages || []) {
        for (const section of page.sections || []) {
            for (const field of section.editableFields || []) {
                fields.push({
                    id: `${page.id}__${section.id}__${field.key}`,
                    pageId: page.id,
                    sectionId: section.id,
                    fieldKey: field.key,
                    type: field.type,
                    label: field.label || field.key,
                    originalValue: field.originalValue ?? field.value,
                    draftValue: field.value,
                    selector: field.selector,
                });
            }
        }
    }
    return fields;
}

module.exports = {
    extractColorsFromSchema,
    flattenEditableFields,
    extractColorsFromCss,
};
