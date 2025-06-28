// File: ./components/mixins/page-animation-mixin.ts
// UPDATE: This mixin is now simplified as the View Transitions API handles animations.
// The primary remaining purpose is to add the data-attribute for querying.
import type { LitElement } from "lit";
import type { Constructor } from "@lit/reactive-element/decorators/base.js";

// The AnimateOnNav interface is no longer needed with the View Transitions API.

export const PageAnimationMixin = <T extends Constructor<LitElement>>(
  superClass: T,
) => {
  class MixedClass extends superClass {
    connectedCallback() {
      super.connectedCallback();
      // Add a data-attribute to self so the app-shell can find this component.
      // While not used by the new View Transitions API, it can be useful for styling/testing.
      this.setAttribute("data-page-component", "");
    }
  }
  return MixedClass;
};
