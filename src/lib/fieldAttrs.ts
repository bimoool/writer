/**
 * Атрибуты текстовых полей. Мобильные браузеры (в том числе Chrome на iPhone) показывают над клавиатурой
 * панель автозаполнения (пароли, карты, адреса), если считают поле подходящим. Чтобы этого не было, у каждого
 * текстового поля приложения те же атрибуты, и они собраны здесь, а не повторяются в компонентах.
 *
 * - autocomplete="off" и нейтральное name: никаких name и id вроде name, email, address, user, pass, card, search;
 * - data-атрибуты, которые просят отстать менеджеры паролей (LastPass, 1Password, Bitwarden и общий form-type);
 * - поля не оборачиваются в <form>;
 * - spellcheck включён: подчёркивание ошибок и подсказки слов на клавиатуре полезны при письме
 *   и автозаполнением не являются.
 */

export const FIELD_NAMES = {
  /** Поле письма в сессии. */
  retelling: 'retelling-text',
  /** Поле правки блока на Result. */
  resultEdit: 'result-edit',
  /** Поле вставки исходного текста на Home. */
  source: 'source-text',
  /** Поле переименования документа. */
  title: 'doc-title',
} as const;

export type FieldName = (typeof FIELD_NAMES)[keyof typeof FIELD_NAMES];

/** Общий набор: всё, что одинаково для textarea и input. */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  autoCapitalize: 'sentences',
  spellCheck: true,
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

export const textareaProps = (name: FieldName) =>
  ({ ...NO_AUTOFILL, name, inputMode: 'text', enterKeyHint: 'enter' }) as const;

/** Однострочное поле: Enter сохраняет, поэтому на клавиатуре «Готово», а не перевод строки. */
export const inputProps = (name: FieldName) =>
  ({ ...NO_AUTOFILL, name, type: 'text', inputMode: 'text', enterKeyHint: 'done' }) as const;
