<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import type { Conversation } from '../../types/index.ts'

import { t } from '@nextcloud/l10n'
import { computed, ref, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'
import { useStore } from 'vuex'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconArrowExpand from 'vue-material-design-icons/ArrowExpand.vue'
import IconClose from 'vue-material-design-icons/Close.vue'
import IconDragHorizontal from 'vue-material-design-icons/DragHorizontal.vue'
import CallTime from '../TopBar/CallTime.vue'
import CallView from './CallView.vue'
import { provideCallViewToken } from '../../composables/useCallViewToken.ts'
import { useDraggableBounded } from '../../composables/useDraggableBounded.ts'
import BrowserStorage from '../../services/BrowserStorage.js'

const props = defineProps<{
	/** Token of the conversation with the active call */
	token: string
}>()

const emit = defineEmits<{
	/** The floating view is dismissed, the call continues */
	(event: 'close'): void
}>()

type Size = { width: number, height: number }

const DEFAULT_SIZE: Size = { width: 400, height: 300 }
const MIN_SIZE: Size = { width: 320, height: 200 }
const SIZE_STORAGE_KEY = 'floatingActiveCallSize'

const store = useStore()
const router = useRouter()

// Components in the bar (e.g. CallTime) should refer to the call, not to the opened conversation
provideCallViewToken(() => props.token)

const floatingCallContainer = useTemplateRef<HTMLDivElement>('floatingCallContainer')
const floatingCall = useTemplateRef<HTMLDivElement>('floatingCall')
const floatingCallBar = useTemplateRef<HTMLDivElement>('floatingCallBar')

const { isDragging, style: draggableStyle, position } = useDraggableBounded(floatingCall, floatingCallContainer, {
	// Clamped to the top right corner of the container, below the conversation top bar
	initialValue: { x: Number.MAX_SAFE_INTEGER, y: 64 },
	handle: floatingCallBar,
})

const size = ref<Size>(readStoredSize())
const sizeStyle = computed(() => ({ width: size.value.width + 'px', height: size.value.height + 'px' }))
const isResizing = ref(false)

const conversation = computed<Conversation | undefined>(() => store.getters.conversation(props.token))

const expandLabel = t('spreed', 'Expand')
const dismissLabel = t('spreed', 'Dismiss')

/**
 * Open the conversation with the call to show it in the main view
 */
function openCall() {
	router.push({ name: 'conversation', params: { token: props.token } })
}

/**
 * Get the size of the floating view, last chosen by the user
 */
function readStoredSize(): Size {
	try {
		const { width, height } = JSON.parse(BrowserStorage.getItem(SIZE_STORAGE_KEY) ?? '') as Partial<Size>
		if (typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height)) {
			return { width: Math.max(width, MIN_SIZE.width), height: Math.max(height, MIN_SIZE.height) }
		}
	} catch {
		// No valid size stored
	}
	return { ...DEFAULT_SIZE }
}

/**
 * Resize the floating view by dragging one of its bottom corners, keeping it within the container
 *
 * @param event pointerdown event on the resize handle
 * @param corner which bottom corner is dragged
 */
function startResize(event: PointerEvent, corner: 'left' | 'right') {
	if (!floatingCallContainer.value) {
		return
	}

	const handle = event.currentTarget as HTMLElement
	const container = floatingCallContainer.value.getBoundingClientRect()
	const startPointer = { x: event.clientX, y: event.clientY }
	const startSize = { ...size.value }
	const startPosition = { ...position.value }

	handle.setPointerCapture(event.pointerId)
	isResizing.value = true

	const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

	const onPointerMove = (moveEvent: PointerEvent) => {
		const deltaX = moveEvent.clientX - startPointer.x
		const deltaY = moveEvent.clientY - startPointer.y

		const height = clamp(startSize.height + deltaY, MIN_SIZE.height, container.height - startPosition.y)
		if (corner === 'right') {
			const width = clamp(startSize.width + deltaX, MIN_SIZE.width, container.width - startPosition.x)
			size.value = { width, height }
		} else {
			// The right edge stays in place, the left edge follows the pointer
			const width = clamp(startSize.width - deltaX, MIN_SIZE.width, startPosition.x + startSize.width)
			size.value = { width, height }
			position.value = { x: startPosition.x + startSize.width - width, y: startPosition.y }
		}
	}

	const onPointerUp = () => {
		handle.removeEventListener('pointermove', onPointerMove)
		handle.removeEventListener('pointerup', onPointerUp)
		handle.removeEventListener('pointercancel', onPointerUp)
		handle.removeEventListener('lostpointercapture', onPointerUp)
		isResizing.value = false
		BrowserStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size.value))
	}

	handle.addEventListener('pointermove', onPointerMove)
	handle.addEventListener('pointerup', onPointerUp)
	handle.addEventListener('pointercancel', onPointerUp)
	// Stop resizing, even if the pointer was released without a 'pointerup' event (e.g. outside of the window)
	handle.addEventListener('lostpointercapture', onPointerUp)
}
</script>

<template>
	<div ref="floatingCallContainer" class="floating-active-call__container">
		<div
			ref="floatingCall"
			class="floating-active-call"
			:class="{ 'floating-active-call--dragging': isDragging, 'floating-active-call--resizing': isResizing }"
			:style="[draggableStyle, sizeStyle]">
			<div ref="floatingCallBar" class="floating-active-call__bar">
				<span class="floating-active-call__name" :title="conversation?.displayName">
					{{ conversation?.displayName }}
				</span>
				<IconDragHorizontal :size="30" />
				<div class="floating-active-call__controls">
					<CallTime v-if="conversation" :start="conversation.callStartTime" />
					<NcButton
						:title="expandLabel"
						:aria-label="expandLabel"
						variant="tertiary-no-background"
						@click="openCall">
						<template #icon>
							<IconArrowExpand :size="20" fillColor="var(--color-primary-text)" />
						</template>
					</NcButton>
					<NcButton
						:title="dismissLabel"
						:aria-label="dismissLabel"
						variant="tertiary-no-background"
						@click="emit('close')">
						<template #icon>
							<IconClose :size="20" fillColor="var(--color-primary-text)" />
						</template>
					</NcButton>
				</div>
			</div>
			<div class="floating-active-call__app">
				<CallView :token="token" isSidebar />
			</div>
			<div
				class="floating-active-call__resize floating-active-call__resize--left"
				aria-hidden="true"
				@pointerdown.prevent.stop="startResize($event, 'left')" />
			<div
				class="floating-active-call__resize floating-active-call__resize--right"
				aria-hidden="true"
				@pointerdown.prevent.stop="startResize($event, 'right')" />
		</div>
	</div>
</template>

<style lang="scss" scoped>
@use '../../assets/variables.scss' as *;

.floating-active-call__container {
	position: absolute;
	inset: 0;
	z-index: 2000;

	// Make container transparent to user events
	pointer-events: none;

	& .floating-active-call__bar,
	& .floating-active-call__bar *,
	& .floating-active-call__app,
	& .floating-active-call__app *,
	& .floating-active-call__resize {
		pointer-events: auto;
		box-sizing: border-box;
	}
}

.floating-active-call {
	position: absolute;
	border-radius: var(--border-radius-element);
	// The call background is translucent, the conversation behind should not be visible through it
	background-color: var(--color-main-background);
	box-shadow: 0 0 4px 0 var(--color-box-shadow);
	// The floating view is moved and resized with the pointer, selecting or dragging its content only gets in the way
	user-select: none;
	-webkit-user-drag: none;

	& * {
		-webkit-user-drag: none;
	}

	&.floating-active-call--resizing {
		// Prevent videos and other elements from catching the pointer while resizing
		.floating-active-call__app {
			pointer-events: none;
		}
	}

	&.floating-active-call--dragging .floating-active-call__bar {
		&,
		& *:not(button) {
			cursor: grabbing;
		}
	}
}

.floating-active-call__bar {
	display: grid;
	// The name shrinks first, so the controls always fit
	grid-template-columns: minmax(0, 1fr) var(--default-clickable-area) minmax(min-content, 1fr);
	gap: var(--default-grid-baseline);
	align-items: center;

	height: calc(var(--default-clickable-area) + var(--default-grid-baseline));
	padding: calc(0.5 * var(--default-grid-baseline)) calc(2 * var(--default-grid-baseline));
	border-start-start-radius: var(--border-radius-element);
	border-start-end-radius: var(--border-radius-element);

	color: var(--color-primary-text);
	background-color: var(--color-primary);

	&,
	& *:not(button) {
		cursor: grab;
	}
}

.floating-active-call__name {
	font-weight: 700;

	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.floating-active-call__controls {
	display: flex;
	justify-content: flex-end;
	gap: var(--default-grid-baseline);
}

.floating-active-call__app {
	position: relative;
	display: flex;
	flex-direction: column;
	justify-content: center;

	height: calc(100% - var(--default-clickable-area) - var(--default-grid-baseline));
	width: 100%;
	border-end-start-radius: var(--border-radius-element);
	border-end-end-radius: var(--border-radius-element);

	background: $color-call-background;

	overflow: hidden;
	// Own stacking context, so the resize handles stay above the call view
	isolation: isolate;
}

// Physical sides on purpose: the floating view is positioned with physical left/top coordinates
/* stylelint-disable csstools/use-logical */
.floating-active-call__resize {
	position: absolute;
	bottom: 0;
	z-index: 1;
	width: calc(4 * var(--default-grid-baseline));
	height: calc(4 * var(--default-grid-baseline));

	&--left {
		left: 0;
		cursor: nesw-resize;
	}

	&--right {
		right: 0;
		cursor: nwse-resize;
	}
}
/* stylelint-enable csstools/use-logical */
</style>
