<!--
  - SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<script setup lang="ts">
import { t } from '@nextcloud/l10n'
import { useElementBounding } from '@vueuse/core'
import { computed, ref, useTemplateRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import NcButton from '@nextcloud/vue/components/NcButton'
import IconArrowExpand from 'vue-material-design-icons/ArrowExpand.vue'
import IconClose from 'vue-material-design-icons/Close.vue'
import CallView from './CallView.vue'
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

/**
 * Which edges of the floating view a resize handle moves, per axis:
 * -1 - the left/top edge, 1 - the right/bottom edge, 0 - none
 */
type ResizeDirection = { x: -1 | 0 | 1, y: -1 | 0 | 1 }

// Corners go last, to be above the sides they overlap
const RESIZE_HANDLES: Array<{ name: string } & ResizeDirection> = [
	{ name: 'top', x: 0, y: -1 },
	{ name: 'bottom', x: 0, y: 1 },
	{ name: 'left', x: -1, y: 0 },
	{ name: 'right', x: 1, y: 0 },
	{ name: 'top-left', x: -1, y: -1 },
	{ name: 'top-right', x: 1, y: -1 },
	{ name: 'bottom-left', x: -1, y: 1 },
	{ name: 'bottom-right', x: 1, y: 1 },
]

const router = useRouter()

const floatingCallBounds = useTemplateRef<HTMLDivElement>('floatingCallBounds')
const floatingCallContainer = useTemplateRef<HTMLDivElement>('floatingCallContainer')
const floatingCall = useTemplateRef<HTMLDivElement>('floatingCall')

// Controls keep working as usual, the rest of the floating view (incl. videos) moves it
const NOT_DRAGGABLE_SELECTOR = 'button, a, input, textarea, select, [role="button"], .floating-active-call__resize'
// Pointer movement, after which the drag is not considered as a click anymore
const CLICK_DISTANCE = 4

let dragStartPointer = { x: 0, y: 0 }

const { isDragging, style: draggableStyle, position } = useDraggableBounded(floatingCall, floatingCallContainer, {
	// Off-screen until placed in the conversation area (see below)
	initialValue: { x: Number.MAX_SAFE_INTEGER, y: 64 },
	onStart: (_, event) => {
		if ((event.target as Element).closest(NOT_DRAGGABLE_SELECTOR)) {
			return false
		}
		dragStartPointer = { x: event.clientX, y: event.clientY }
	},
	onEnd: (_, event) => {
		if (Math.hypot(event.clientX - dragStartPointer.x, event.clientY - dragStartPointer.y) > CLICK_DISTANCE) {
			preventNextClick()
		}
	},
})

// The floating view is rendered in the body, above the app navigation and sidebars,
// and can be moved within the whole Talk app (but not over the header above it)
const bounds = useElementBounding(() => floatingCallBounds.value?.closest<HTMLElement>('#content-vue') ?? floatingCallBounds.value)
const containerStyle = computed(() => ({
	left: bounds.left.value + 'px',
	top: bounds.top.value + 'px',
	width: bounds.width.value + 'px',
	height: bounds.height.value + 'px',
}))

const size = ref<Size>(readStoredSize())
const sizeStyle = computed(() => ({ width: size.value.width + 'px', height: size.value.height + 'px' }))
const isResizing = ref(false)

// Initially placed at the top right corner of the conversation area, below its top bar
const stopInitialPlacement = watch(() => bounds.width.value, (width) => {
	if (!width || !floatingCallBounds.value) {
		return
	}
	const area = floatingCallBounds.value.getBoundingClientRect()
	position.value = {
		x: Math.max(0, area.right - bounds.left.value - size.value.width),
		y: area.top - bounds.top.value + 64,
	}
	stopInitialPlacement()
}, { flush: 'post' })

const expandLabel = t('spreed', 'Expand')
const dismissLabel = t('spreed', 'Dismiss')

/**
 * Open the conversation with the call to show it in the main view
 */
function openCall() {
	router.push({ name: 'conversation', params: { token: props.token } })
}

/**
 * Prevent the click following the drag, so dropping the view on a video doesn't select it
 */
function preventNextClick() {
	const preventClick = (event: MouseEvent) => {
		event.stopPropagation()
		event.preventDefault()
	}
	window.addEventListener('click', preventClick, { capture: true, once: true })
	// The click is not fired, if the pointer was released outside of the element where it was pressed
	setTimeout(() => window.removeEventListener('click', preventClick, { capture: true }))
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
 * Resize the floating view by dragging one of its sides or corners, keeping it within the container
 *
 * @param event pointerdown event on the resize handle
 * @param direction which edges are moved by the handle
 */
function startResize(event: PointerEvent, direction: ResizeDirection) {
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

	/**
	 * Resize along one axis: the moved edge follows the pointer, the opposite edge stays in place
	 *
	 * @param edge which edge is moved along the axis
	 * @param delta pointer movement along the axis
	 * @param start start position of the view along the axis
	 * @param length start size of the view along the axis
	 * @param minLength minimal size along the axis
	 * @param containerLength size of the container along the axis
	 */
	const resizeAxis = (edge: -1 | 0 | 1, delta: number, start: number, length: number, minLength: number, containerLength: number) => {
		if (edge === 1) {
			return { start, length: clamp(length + delta, minLength, containerLength - start) }
		}
		if (edge === -1) {
			const newLength = clamp(length - delta, minLength, start + length)
			return { start: start + length - newLength, length: newLength }
		}
		return { start, length }
	}

	const onPointerMove = (moveEvent: PointerEvent) => {
		const x = resizeAxis(direction.x, moveEvent.clientX - startPointer.x, startPosition.x, startSize.width, MIN_SIZE.width, container.width)
		const y = resizeAxis(direction.y, moveEvent.clientY - startPointer.y, startPosition.y, startSize.height, MIN_SIZE.height, container.height)
		size.value = { width: x.length, height: y.length }
		position.value = { x: x.start, y: y.start }
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
	<div ref="floatingCallBounds" class="floating-active-call__bounds" />
	<Teleport to="body">
		<!-- Add .app-talk to use Talk styles outside of #content-vue -->
		<div
			ref="floatingCallContainer"
			class="floating-active-call__container app-talk"
			:style="containerStyle">
			<div
				ref="floatingCall"
				class="floating-active-call"
				:class="{ 'floating-active-call--dragging': isDragging, 'floating-active-call--resizing': isResizing }"
				:style="[draggableStyle, sizeStyle]">
				<div class="floating-active-call__app">
					<CallView :token="token" isSidebar isFloating />
					<!-- Painted with the palette of the call, as the bottom bar -->
					<div class="floating-active-call__actions" data-theme-dark>
						<NcButton
							:title="expandLabel"
							:aria-label="expandLabel"
							variant="tertiary"
							@click="openCall">
							<template #icon>
								<IconArrowExpand :size="20" />
							</template>
						</NcButton>
						<NcButton
							:title="dismissLabel"
							:aria-label="dismissLabel"
							variant="tertiary"
							@click="emit('close')">
							<template #icon>
								<IconClose :size="20" />
							</template>
						</NcButton>
					</div>
				</div>
				<div
					v-for="handle in RESIZE_HANDLES"
					:key="handle.name"
					class="floating-active-call__resize"
					:class="`floating-active-call__resize--${handle.name}`"
					aria-hidden="true"
					@pointerdown.prevent.stop="startResize($event, handle)" />
			</div>
		</div>
	</Teleport>
</template>

<style lang="scss" scoped>
@use '../../assets/variables.scss' as *;

.floating-active-call__bounds {
	position: absolute;
	inset: 0;
	visibility: hidden;
	pointer-events: none;
}

.floating-active-call__container {
	position: fixed;
	// Above the app navigation and its toggle, below modals and popovers
	z-index: 2000;

	// Make container transparent to user events
	pointer-events: none;

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

	&.floating-active-call--dragging {
		&,
		& *:not(button) {
			cursor: grabbing;
		}
	}
}

.floating-active-call__app {
	position: relative;
	display: flex;
	// The floating view can be moved by its videos as well
	cursor: grab;
	flex-direction: column;
	justify-content: center;

	height: 100%;
	width: 100%;
	border-radius: var(--border-radius-element);

	background: $color-call-background;

	overflow: hidden;
	// Own stacking context, so the resize handles stay above the call view
	isolation: isolate;
}

.floating-active-call__actions {
	position: absolute;
	top: calc(2 * var(--default-grid-baseline));
	inset-inline-end: calc(2 * var(--default-grid-baseline));
	z-index: 20;
	display: flex;
	gap: var(--default-grid-baseline);
	// Only shown while the floating view is hovered or focused
	opacity: 0;
	transition: opacity var(--animation-quick) ease-in-out;

	@media (hover: none) {
		opacity: 1;
	}

	.floating-active-call:hover &,
	&:focus-within {
		opacity: 1;
	}

	// Same as the buttons of the bottom bar
	.button-vue--tertiary {
		background-color: var(--color-primary-light);
	}
}

@media (prefers-reduced-motion: reduce) {
	.floating-active-call__actions {
		transition: none;
	}
}

// Physical sides on purpose: the floating view is positioned with physical left/top coordinates
/* stylelint-disable csstools/use-logical */
.floating-active-call__resize {
	--resize-side: calc(1.5 * var(--default-grid-baseline));
	--resize-corner: calc(4 * var(--default-grid-baseline));
	position: absolute;
	z-index: 1;

	&--top,
	&--bottom {
		left: var(--resize-corner);
		right: var(--resize-corner);
		height: var(--resize-side);
		cursor: ns-resize;
	}

	&--left,
	&--right {
		top: var(--resize-corner);
		bottom: var(--resize-corner);
		width: var(--resize-side);
		cursor: ew-resize;
	}

	&--top-left,
	&--top-right,
	&--bottom-left,
	&--bottom-right {
		width: var(--resize-corner);
		height: var(--resize-corner);
	}

	&--top,
	&--top-left,
	&--top-right {
		top: 0;
	}

	&--bottom,
	&--bottom-left,
	&--bottom-right {
		bottom: 0;
	}

	&--left,
	&--top-left,
	&--bottom-left {
		left: 0;
	}

	&--right,
	&--top-right,
	&--bottom-right {
		right: 0;
	}

	&--top-left,
	&--bottom-right {
		cursor: nwse-resize;
	}

	&--top-right,
	&--bottom-left {
		cursor: nesw-resize;
	}
}
/* stylelint-enable csstools/use-logical */
</style>
