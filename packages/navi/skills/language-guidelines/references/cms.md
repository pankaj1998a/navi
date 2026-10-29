# Content Management Systems

> Source: https://developer.wordpress.org/coding-standards/wordpress-coding-standards/, https://www.drupal.org/docs/develop/standards, https://developer.adobe.com/commerce/php/coding-standards/, https://octobercms.com/help/guidelines/developer

## Quick Rules
- Detect the CMS from the project (a `wp-content` tree, a `core/` Drupal tree, a `composer.json` requiring `magento/framework`, a `modules/` tree) and follow that CMS's standards.
- Never edit core files. Add behaviour through plugins, modules, extensions, or the CMS's documented extension points.
- Escape on output: use the CMS's escaping helpers (`esc_html`, `esc_attr`, `esc_url`) rather than raw echo.
- Use the CMS's sanitization and API layer for input instead of hand-written SQL or direct superglobal use.
- Localize user-facing strings with the CMS's translation functions, not with hard-coded English.
- Never store secrets in the database or in a checked-in config file; use the CMS's secret/environment mechanism.
- Protect state-changing operations with the CMS's nonce, capability, or CSRF mechanism.
- Keep database access behind the CMS's query API with prepared statements.
- Meet WCAG 2.1 AA for front-end output: alt text, labelled forms, keyboard operability, contrast.

## WordPress

### WordPress Core and Plugins
- PHP standard is the WordPress Coding Standards (WPCS), based on PEAR plus WordPress-specific rules.
- Indent with tabs in PHP; spaces inside parentheses; spaces around comparisons and concatenations.
- Use Yoda conditions: `if ( 'post' === $post_type )`.
- Function and variable names in `snake_case`; class names in `StudlyCaps` prefixed with the plugin's namespace; file names `my-plugin-class.php` in lowercase with hyphens.
- Constants in `UPPER_SNAKE_CASE`, prefixed with the plugin name; global functions and hooks prefixed with the plugin slug.
- Escape output with `esc_html()`, `esc_attr()`, `esc_url()`, `esc_js()`; sanitize input with `sanitize_text_field()`, `absint()`, `wp_kses()`.
- Use `$wpdb->prepare()` for every query that includes variable data; never concatenate SQL.
- Prefix all options, post meta, and custom tables with the plugin prefix; use `dbDelta()` for table creation.
- Run `phpcs` with the `WordPress` ruleset in CI and fix with `phpcbf`.

### WordPress Themes
- Template files use the template hierarchy naming (`index.php`, `single.php`, `archive.php`, `404.php`).
- The theme's `style.css` header must declare the theme name, URI, author, version, and license.
- Escape everything printed; use `esc_html__()` for translatable text and `esc_html_e()` when echoing directly.
- Enqueue scripts and styles with `wp_enqueue_script()` / `wp_enqueue_style()`; never print `<script>` or `<link>` tags inline.
- Use `get_template_part()` and `get_header()`/`get_footer()` rather than duplicating markup.
- Provide `theme.json` for global settings and block styles; support `wp_body_open()`.

## Drupal

### Drupal Modules and Themes
- Drupal core and contributed modules follow PSR-12 with 2-space indentation.
- Classes in `StudlyCaps` in `src/`; services declared in `src/<Module>ServiceProvider.php` and configured in `services.yml`.
- Function names in `snake_case`, prefixed with the module name; hook implementations named `mymodule_entity_insert()`.
- Configuration in YAML under `config/`; import and export with `drush config:export` rather than editing the database.
- Use the service container and dependency injection; never call `Drupal::service()` inside business logic.
- Use typed data, entities, and form API rather than raw database queries; when a query is unavoidable, use the query builder.
- Add `hook_update_N()` to `mymodule.install` for schema changes; never edit an already-shipped `hook_update_N()`.
- Twig templates: lowercase underscored variables, `{% extends %}` first, `{% block %}` names matching the block content, and `trans` filters for translatable text.
- Prefix all configuration keys, routes, permissions, and services with the module name to avoid collisions.

## Magento

### Magento 2 Modules
- Adobe Commerce and Magento Open Source use the `Magento2` PHP_CodeSniffer standard plus `PHPCompatibility`.
- Run `vendor/bin/phpcs --standard=Magento2 <path>` and fix with `phpcbf`.
- Classes in `StudlyCaps` under `app/code/<Vendor>/<Module>/`; layout, template, and config XML under `view/` and `etc/`.
- Use constructor dependency injection, never `ObjectManager::getInstance()` in application code.
- Use repositories and factories (`ProductRepositoryInterface`, `ProductFactory`) rather than `Magento\Framework\Model\AbstractModel` directly.
- Implement `di.xml` for preferences, plugins, and virtual types; avoid `ObjectManager` and `Registry` (deprecated).
- Enforce ACL for admin actions with `acl.xml`; escape output with `$escaper->escapeHtml()` and validate input.
- Use setup patches (`Setup\Patch\Data`) for schema and data changes; keep `db_schema.xml` declarative.
- Front-end: use Knockout/Vue components under `view/frontend/web/js/`, with `*.html` templates and `requirejs-config.js` wiring.

## OctoberCMS

### OctoberCMS Plugins and Themes
- PHP follows PSR-2 with documented exceptions; `camelCase` for PHP variables, `snake_case` for database attributes, postback parameters, HTML elements, and language keys.
- Vendor namespace starts with an uppercase letter and contains no underscores or dashes: `Acme.Blog`.
- Plugin and theme folders are suffixed `-plugin` and `-theme` (`blog-plugin`, `happy-theme`); the Composer package name matches.
- View files end in `.htm`; partial views start with `_`; use `-` for spaces and `_` for folders in view names.
- Classes live in `classes/`, controllers (plural) in `controllers/`, models (singular) in `models/`, components in `components/`.
- Model scopes that return a query use an `apply` prefix (`scopeApplyUser`); other scopes use `is`, `for`, `with`, `without`, or `filter`.
- Event names use the `before` prefix for pre-logic (`beforeSetAttribute`); global events are prefixed with the plugin code.
- Table names are prefixed with author and plugin (`acme_blog_xxx`); boolean columns use `is_` (`is_activated`).
- Keep MySQL in `STRICT_TRANS_TABLES` mode and set `'strict' => true` in `config/database.php`.

## Anti-Patterns
- Editing core CMS files to add a feature. Instead: use a plugin, module, or extension and keep the core tree clean.
- Printing raw user input or a raw DB value. Instead: escape on output with the CMS's escaping helper.
- Building SQL by string concatenation. Instead: use the CMS's query API with prepared statements.
- Storing API keys, salts, or payment credentials in options, config files, or the database. Instead: use the CMS's environment/secret mechanism.
- Skipping nonce or capability checks on admin POST handlers. Instead: validate the request and the user's permissions.
- Shipping raw HTML strings from the database without sanitising on render. Instead: apply the CMS's KSES or equivalent filter.
- Ignoring the CMS's translation functions and hard-coding English UI strings. Instead: wrap them for i18n.
- Overriding core behaviour with copied-and-pasted code. Instead: use hooks, plugins, or events.

## Sources
- https://developer.wordpress.org/coding-standards/wordpress-coding-standards/
- https://www.drupal.org/docs/develop/standards
- https://developer.adobe.com/commerce/php/coding-standards/
- https://octobercms.com/help/guidelines/developer
- https://developer.wordpress.org/apis/security/
