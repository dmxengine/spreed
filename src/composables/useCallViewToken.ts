/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { ComputedRef, InjectionKey, MaybeRefOrGetter, Ref } from 'vue'

import { computed, inject, provide, toValue } from 'vue'
import { useGetToken } from './useGetToken.ts'

const CALL_VIEW_TOKEN_KEY: InjectionKey<ComputedRef<string>> = Symbol('CallView:token')

/**
 * Provide the token of the call for the call view components.
 * The call can be rendered outside of its conversation (e.g. in a floating view while browsing other conversations),
 * so call view components should not rely on the current route token.
 *
 * @param token token of the conversation with the call
 */
export function provideCallViewToken(token: MaybeRefOrGetter<string>) {
	provide(CALL_VIEW_TOKEN_KEY, computed(() => toValue(token)))
}

/**
 * Get the token of the call in call view components. Falls back to the current route token.
 */
export function useCallViewToken(): Readonly<Ref<string>> {
	return inject(CALL_VIEW_TOKEN_KEY, null) ?? useGetToken()
}
