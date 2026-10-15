/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { createSharedComposable } from '@vueuse/core'
import { computed } from 'vue'
import { useStore } from 'vuex'
import { useGetToken } from './useGetToken.ts'
import { useJoinedConversation } from './useJoinedConversation.ts'

/**
 * Token of the conversation, which call the user joined in this tab, or null when not in a call.
 * Unlike useIsInCall, it doesn't depend on the currently opened conversation:
 * while in a call, other conversations can be opened (browsed) without leaving the call.
 */
export const useActiveCallToken = createSharedComposable(function() {
	const store = useStore()
	const joinedConversationToken = useJoinedConversation()

	return computed<string | null>(() => {
		const token = joinedConversationToken.value
		return token && store.getters.isInCall(token) ? token : null
	})
})

/**
 * Whether another conversation is currently opened, while the call continues in the joined conversation.
 * Such conversation is browsed without joining it, so the session (and the call) remains in the joined one.
 */
export const useIsBrowsingDuringCall = createSharedComposable(function() {
	const token = useGetToken()
	const activeCallToken = useActiveCallToken()

	return computed(() => !!activeCallToken.value && !!token.value && activeCallToken.value !== token.value)
})
