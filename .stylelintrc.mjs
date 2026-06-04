export default {
  extends: ['stylelint-config-standard', 'stylelint-config-recess-order'],
  rules: {
    'selector-class-pattern': null,
    // Tailwind v4 requires the bare-string import form (`@import 'tailwindcss'`);
    // the url() form stylelint defaults to is not recognised by the compiler.
    'import-notation': 'string',
    // Token files group custom properties with blank lines for readability.
    'custom-property-empty-line-before': null,
    // Tailwind v4 CSS-first at-rules are not known to stylelint-config-standard
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'theme',
          'source',
          'utility',
          'variant',
          'custom-variant',
          'apply',
          'reference',
          'config',
          'plugin',
          'tailwind'
        ]
      }
    ]
  }
}
