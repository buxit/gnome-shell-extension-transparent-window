const St = imports.gi.St;
const Main = imports.ui.main;
//const Tweener = imports.ui.tweener; //not referenced anywhere in file and apparently not needed. commented out for 3.38 compatibility
const Shell = imports.gi.Shell;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Meta = imports.gi.Meta;
const Clutter = imports.gi.Clutter;

const Gdk = imports.gi.Gdk;
const GLib = imports.gi.GLib;

//logger
const currentExtension = ExtensionUtils.getCurrentExtension();
const Logger = currentExtension.imports.logger.Logger;

//setting
const Convenience = currentExtension.imports.convenience;
let setting;

const Utils = Me.imports.utils;
const isVersionGreaterOrEqual = Utils.isVersionGreaterOrEqual;

let text, button, settings, win_actor, overlayContainer, overlay, sig_scroll, keymap, sig_keymap;
let step = 5;
let min_opacity = 20;
let overlayExists = false; //ensure only one overlay is created

let Log;

let sig_verbose_level;
let sig_modifier_key;
let modifier_key;
let gnome_at_least_3_34;
let gnome_at_least_3_38;
let gnome_at_least_40_1;

let keymap_timeout_id;


//TODO: Add "About" page. Add config for minimum opacity and step.
function init() {
  
}

function getMouseHoveredWindowActor() {
  let [mouse_x, mouse_y, mask] = global.get_pointer();
  Log.debug(mouse_x + "," + mouse_y);
  let window_actors = global.get_window_actors();
  let result = null;
  window_actors.forEach(function(actor) {
    let fr = actor.get_meta_window().get_frame_rect();
    let xmin = fr.x;
    let ymin = fr.y;
    let xmax = xmin + fr.width;
    let ymax = ymin + fr.height;
    if(xmin < mouse_x && mouse_x < xmax && ymin < mouse_y && mouse_y < ymax) {
      result = actor;
    }
  });
  return result;
}

function onScroll(actor, event) {
  Log.debug("on scroll");
  win_actor = getMouseHoveredWindowActor();
  //Gnome 3.34 and above introduced MetaSurfaceActor. We need to get this actor below MetaWindowActor and apply opacity-change on it.
  if (gnome_at_least_3_34) win_actor = win_actor.first_child;
  let opacity = win_actor.get_opacity();

  let dir = event.get_scroll_direction();
  Log.debug(dir);
  switch(dir) {
    case Clutter.ScrollDirection.UP:
      opacity += step;
      break;
    case Clutter.ScrollDirection.DOWN:
      opacity -= step;
      break;
    default:
      return Clutter.EVENT_PROPAGATE;
  }
  Log.debug("opacity: " + opacity);
  win_actor.set_opacity(Math.max(min_opacity, Math.min(opacity, 255)));
  return Clutter.EVENT_STOP;
}


function createOverlay() {
  if(overlayExists) return;
  win_actor = getMouseHoveredWindowActor();
  if (!win_actor) return;
  Log.debug("create overlay");
  let meta_window = win_actor.get_meta_window();
  let frame_rect = meta_window.get_frame_rect();
  let pos_x = frame_rect.x;
  let pos_y = frame_rect.y;
  let size_x = frame_rect.width;
  overlayContainer = new St.Widget({
    clip_to_allocation: true
  });
  Main.layoutManager.addChrome(overlayContainer, {affectsInputRegion: false});
  
  // check gnome version to determine correct call to create new overlay 
  if (gnome_at_least_3_38) {
    overlay = new St.Bin({ style_class: '', reactive: true, can_focus: true, x_expand: true, y_expand: false, track_hover: true });
  } else {
    overlay = new St.Bin({ style_class: '', reactive: true, can_focus: true, x_fill: true, y_fill: false, track_hover: true });
  };
  overlay.set_position(pos_x, pos_y);
  overlay.set_size(size_x, 40);
  sig_scroll = overlay.connect("scroll-event", onScroll);
  overlayContainer.add_actor(overlay);
  Main.layoutManager.trackChrome(overlay, {affectsInputRegion: true});

  overlayExists = true;
}

function destroyOverlay() {
  if(!overlayExists) return;
  overlayExists = false;
  Log.debug("overlay destroyed");
  if(overlayContainer) Main.layoutManager.removeChrome(overlayContainer);
  if(overlay) Main.layoutManager.untrackChrome(overlay);
  if(overlay && sig_scroll) overlay.disconnect(sig_scroll);
  sig_scroll = null;
  if(overlay) overlay.destroy();
  if(overlayContainer) overlayContainer.destroy();
}

function onHotkeyPressed() {
  Log.debug("Hot key pressed");
  //Clear the lock bit so the status of Caps_Lock won't affect the functionality
  let multiKeysCode = keymap.get_modifier_state() & (~(2 | 16));
  Log.debug(multiKeysCode);
  switch(multiKeysCode) {
    case modifier_key:
      Log.debug("Modifier key pressed, listening to scroll");
      createOverlay();
      break;
    default:
      destroyOverlay();
      return;
  }
  return;
}

function enable() {
  setting = Convenience.getSettings();
  Log = new Logger("TransparentWindow", setting.get_int('verbose-level'));
  modifier_key = setting.get_int('modifier-key');
  Log.debug("Gnome version:" + imports.misc.config.PACKAGE_VERSION);
  gnome_at_least_3_34 = isVersionGreaterOrEqual(3, 34);
  // gnome 3.38 includes syntax changes to creating new overlay. 
  // this will be used later to decide which method to use in createOverlay 
  gnome_at_least_3_38 = isVersionGreaterOrEqual(3, 38);

  //Periodically get GDK display until success.This would fix "Keymap is null" issue on Wayland 
  keymap_timeout_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
    const display = Gdk.Display.get_default();

    if (display !== null) {
      keymap = Gdk.Keymap.get_for_display(display);
      sig_keymap = keymap.connect('state_changed', onHotkeyPressed);

      return GLib.SOURCE_REMOVE; // destroy task
    }

    return true; // repeat task
  });

  sig_verbose_level = setting.connect('changed::verbose-level', ()=>{Log.setLevel(setting.get_int('verbose-level'))});
  sig_modifier_key = setting.connect('changed::modifier-key', ()=> {modifier_key = setting.get_int('modifier-key');});
}

function disable() {
  GLib.source_remove(keymap_timeout_id);
  if (keymap && sig_keymap) {
    keymap.disconnect(sig_keymap);
  }

  setting.disconnect(sig_verbose_level);
  sig_verbose_level = null;
  setting.disconnect(sig_modifier_key);
  sig_modifier_key = null;

  [keymap, sig_keymap, keymap_timeout_id, setting, Log] = [null, null, null, null, null];
}
