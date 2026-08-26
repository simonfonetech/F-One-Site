"""
Renders FoneTech's GenerateBlocks content (as stored in the WordPress WXR export)
into plain HTML.

GenerateBlocks Pro renders `generateblocks/container` and `generateblocks/grid`
blocks dynamically on the server -- their wrapper HTML is NOT serialized into
post_content, only a JSON attributes comment is. Other blocks used on this site
(generateblocks/headline, generateblocks/button, core image/html/embed/shortcode)
DO carry literal serialized HTML alongside their comments.

Rather than re-deriving each container/grid's visual CSS from its JSON attributes,
this renders the exact DOM structure GenerateBlocks Pro itself outputs:

    <div class="gb-container gb-container-{id}">
      <div class="gb-inside-container"> ...children... </div>
    </div>

    <div class="gb-grid-wrapper gb-grid-wrapper-{id}"> ...gb-grid-column children... </div>

    <div class="gb-grid-column gb-grid-column-{id}">
      <div class="gb-container gb-container-{id}">
        <div class="gb-inside-container"> ...children... </div>
      </div>
    </div>

migrate.py fetches GenerateBlocks' own generated CSS for every page/post
(https://.../wp-content/uploads/generateblocks/style-{postID}.css) which styles
these classes by their real uniqueId -- so the visual result matches the live
site instead of a hand-reconstructed approximation.
"""
import re
import json

OPEN_RE = re.compile(r'<!--\s*(/?)wp:([a-zA-Z0-9_/-]+)\s*(\{.*?\})?\s*(/?)-->', re.DOTALL)

CONTAINER_BLOCKS = {'generateblocks/container', 'generateblocks/grid'}

# GenerateBlocks Pro renders shape dividers (the angled/triangular section edges)
# server-side, so the markup is absent from the export -- only the container's
# `shapeDividers` attribute survives. The per-page CSS fetched from live already
# styles them (colour, height, top/bottom, flips) via
#   .gb-container-{id} > .gb-shapes .gb-shape-{n}
# so all that is missing is the element and its SVG geometry. These four are the
# only shapes the site uses; the markup is copied verbatim from live's output.
SHAPE_SVGS = {
    'gb-angle-1':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 360" '
        'preserveAspectRatio="none"><path d="M1200 360H0V0l1200 348z"/></svg>',
    'gb-triangle-1':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 100" '
        'preserveAspectRatio="none"><path d="M1200 100H0V0l400 77.2L1200 0z"/></svg>',
    'gb-triangle-2':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 100" '
        'preserveAspectRatio="none"><path d="M1200 77.2L400 0 0 77.2V100h1200z"/></svg>',
    'gb-triangle-8':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 230" '
        'preserveAspectRatio="none"><path d="M1200 207.2L600 0 0 207.2V230h1200z"/></svg>',
}

VARIANT_CLASS = {
    'accordion': 'gb-accordion',
    'accordion-item': 'gb-accordion-item',
    'accordion-toggle': 'gb-accordion-toggle',
    'accordion-content': 'gb-accordion-content',
}


class Node:
    __slots__ = ('name', 'attrs', 'children', 'is_html')

    def __init__(self, name=None, attrs=None, is_html=False):
        self.name = name
        self.attrs = attrs or {}
        self.children = []
        self.is_html = is_html


def parse_tree(content):
    """Turn the block-comment-interleaved content string into a Node tree."""
    root = Node(name='__root__')
    stack = [root]
    pos = 0
    for m in OPEN_RE.finditer(content):
        start, end = m.span()
        if start > pos:
            literal = content[pos:start]
            if literal.strip():
                stack[-1].children.append(Node(is_html=True, attrs={'html': literal}))
        pos = end

        closing, name, attrs_raw, self_closing = m.groups()
        if closing:
            for i in range(len(stack) - 1, 0, -1):
                if stack[i].name == name:
                    stack[:] = stack[:i]
                    break
            continue

        attrs = {}
        if attrs_raw:
            try:
                attrs = json.loads(attrs_raw)
            except json.JSONDecodeError:
                attrs = {}

        node = Node(name=name, attrs=attrs)
        stack[-1].children.append(node)
        if not self_closing:
            stack.append(node)

    if pos < len(content):
        literal = content[pos:]
        if literal.strip():
            stack[-1].children.append(Node(is_html=True, attrs={'html': literal}))

    return root


def _extra_classes(attrs):
    classes = []
    variant = attrs.get('variantRole')
    if variant in VARIANT_CLASS:
        classes.append(VARIANT_CLASS[variant])
    if attrs.get('className'):
        classes.append(attrs['className'])
    return classes


def attrs_unique_id(node):
    return node.attrs.get('uniqueId', '')


def _map_block(attrs):
    """Render the WP Map Block as a Google Maps embed.

    The plugin draws the map client-side from its own JS, which the static build
    has no equivalent for, so the block rendered as nothing at all. The block
    attributes carry everything needed -- marker lat/lng, title, zoom, height --
    and the block's own `map_type` is "GM" (Google Maps), so an embed iframe at
    the same coordinates reproduces it without needing an API key.
    """
    markers = attrs.get('map_marker_list') or []
    if not markers:
        return ''
    marker = markers[0]
    lat = marker.get('lat')
    lng = marker.get('lng')
    if lat is None or lng is None:
        return ''
    title = marker.get('title') or 'Location'
    zoom = attrs.get('map_zoom', 16)
    height = attrs.get('map_height', 450)
    src = (f'https://maps.google.com/maps?q={lat},{lng}'
           f'&z={zoom}&hl=en&output=embed')
    safe_title = (str(title).replace('&', '&amp;').replace('"', '&quot;')
                  .replace('<', '&lt;').replace('>', '&gt;'))
    return (
        f'<div class="wpmapblockrender" style="width:100%;height:{height}px">'
        f'<iframe src="{src}" title="{safe_title}" width="100%" height="100%"'
        f' style="border:0" loading="lazy" referrerpolicy="no-referrer-when-downgrade"'
        f' allowfullscreen></iframe>'
        f'</div>'
    )


def _shape_dividers(attrs):
    """Rebuild the <div class="gb-shapes"> block from a container's attributes.

    Read per block instance, not from a lookup keyed on uniqueId: the same id is
    reused across pages with different divider settings (dba2aa1b has one shape
    on one page and two on another), and each page's CSS is generated from that
    page's attributes.
    """
    dividers = attrs.get('shapeDividers') or []
    shapes = []
    for index, divider in enumerate(dividers, start=1):
        svg = SHAPE_SVGS.get(divider.get('shape'))
        if not svg:
            continue
        shapes.append(f'<div class="gb-shape gb-shape-{index}">{svg}</div>')
    if not shapes:
        return ''
    return f'<div class="gb-shapes">{"".join(shapes)}</div>'


def render_node(node):
    if node.is_html:
        return node.attrs.get('html', '')

    if node.name in (None, '__root__'):
        return ''.join(render_node(c) for c in node.children)

    if node.name == 'wpmapblock/wp-map-block':
        return _map_block(node.attrs)

    if node.name == 'generateblocks/button-container':
        # Also dynamic, so the wrapper is absent from the export while the button
        # <a> inside it is serialized. It matters: the per-instance CSS for these
        # buttons is scoped `.gb-button-wrapper a.gb-button-{id}` (56 such rules
        # across 14 page stylesheets), and theme.css styles `.gb-button-wrapper a`
        # with !important. Without the wrapper neither applies and the button
        # falls through to the generic .gb-button fallback -- which is why every
        # industries hero button rendered purple instead of orange.
        inner = ''.join(render_node(c) for c in node.children)
        classes = (['gb-button-wrapper', f'gb-button-wrapper-{attrs_unique_id(node)}']
                   + _extra_classes(node.attrs))
        return f'<div class="{" ".join(classes)}">{inner}</div>'

    if node.name not in CONTAINER_BLOCKS:
        # leaf/core block with its own serialized HTML among children
        return ''.join(render_node(c) for c in node.children)

    attrs = node.attrs
    unique_id = attrs.get('uniqueId', '')
    inner = ''.join(render_node(c) for c in node.children)

    if node.name == 'generateblocks/grid':
        classes = ['gb-grid-wrapper', f'gb-grid-wrapper-{unique_id}'] + _extra_classes(attrs)
        return f'<div class="{" ".join(classes)}">{inner}</div>'

    # generateblocks/container
    container_classes = ['gb-container', f'gb-container-{unique_id}'] + _extra_classes(attrs)
    anchor = attrs.get('anchor')
    id_attr = f' id="{anchor}"' if anchor else ''
    aria = ' aria-expanded="false"' if attrs.get('variantRole') == 'accordion-toggle' else ''

    # A container with a `url` attribute is a GenerateBlocks "container link":
    # an absolutely-positioned overlay anchor making the whole card clickable.
    # It renders dynamically, so it is missing from the export -- which is why
    # the related-model cards on the handset pages were not clickable. The CSS
    # for it is already present (59 .gb-container-link rules). migrate.py
    # rewrites the absolute URL to a local path after rendering.
    link_url = attrs.get('url')
    link_html = (f'<a class="gb-container-link" href="{link_url}"></a>'
                 if link_url else '')

    # shape dividers sit after .gb-inside-container as the container's last
    # child, which is where live puts them and what the CSS selector expects
    container_html = (
        f'<div class="{" ".join(container_classes)}"{id_attr}{aria}>'
        f'{link_html}'
        f'<div class="gb-inside-container">{inner}</div>'
        f'{_shape_dividers(attrs)}</div>'
    )

    if attrs.get('isGrid'):
        column_classes = ['gb-grid-column', f'gb-grid-column-{unique_id}']
        return f'<div class="{" ".join(column_classes)}">{container_html}</div>'

    return container_html


def render(content):
    """Full pipeline entry point: content string -> html string."""
    tree = parse_tree(content)
    return render_node(tree)
