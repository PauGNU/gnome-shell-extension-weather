/*
 *
 *  Weather extension for GNOME Shell
 *  - Displays a small weather information on the top panel.
 *  - On click, gives a popup with details about the weather.
 *
 * Copyright (C) 2011-2012
 *     ecyrbe <ecyrbe+spam@gmail.com>,
 *     Timur Kristof <venemo@msn.com>,
 *     Elad Alfassa <elad@fedoraproject.org>,
 *     Simon Legner <Simon.Legner@gmail.com>,
 *     Mark Benjamin <weather.gnome.Markie1@dfgh.net>,
 *     Canek Peláez <canek@ciencias.unam.mx>,
 *     Christian Metzler <neroth@xeked.com>,
 *     Mattia Meneguzzo <odysseus@fedoraproject.org>
 *
 * This file is part of gnome-shell-extension-weather.
 *
 * gnome-shell-extension-weather is free software: you can
 * redistribute it and/or modify it under the terms of the GNU
 * General Public License as published by the Free Software
 * Foundation, either version 3 of the License, or (at your option)
 * any later version.
 *
 * gnome-shell-extension-weather is distributed in the hope that it
 * will be useful, but WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR
 * PURPOSE.  See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with gnome-shell-extension-weather.  If not, see
 * <http://www.gnu.org/licenses/>.
 *
 */

const Cairo = imports.cairo;
const Clutter = imports.gi.Clutter;
const Gettext = imports.gettext.domain('gnome-shell-extension-weather');
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const Json = imports.gi.Json;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Soup = imports.gi.Soup;
const St = imports.gi.St;
const Util = imports.misc.util;
const _ = Gettext.gettext;

const Main = imports.ui.main;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

// Settings
const WEATHER_SETTINGS_SCHEMA = 'org.gnome.shell.extensions.weather';
const WEATHER_UNIT_KEY = 'unit';
const WEATHER_WIND_SPEED_UNIT_KEY = 'wind-speed-unit';
const WEATHER_CITY_KEY = 'city';
const WEATHER_WOEID_KEY = 'woeid';
const WEATHER_TRANSLATE_CONDITION_KEY = 'translate-condition';
const WEATHER_SHOW_SUNRISE_SUNSET_KEY = 'show-sunrise-sunset';
const WEATHER_USE_SYMBOLIC_ICONS_KEY = 'use-symbolic-icons';
const WEATHER_SHOW_TEXT_IN_PANEL_KEY = 'show-text-in-panel';
const WEATHER_POSITION_IN_PANEL_KEY = 'position-in-panel';
const WEATHER_SHOW_COMMENT_IN_PANEL_KEY = 'show-comment-in-panel';
const WEATHER_REFRESH_INTERVAL = 'refresh-interval';

// Keep enums in sync with GSettings schemas
const WeatherUnits = {
    CELSIUS: 0,
    FAHRENHEIT: 1
};

const WeatherWindSpeedUnits = {
    KPH: 0,
    MPH: 1,
    MPS: 2,
    KNOTS: 3
};

const WeatherPosition = {
    CENTER: 0,
    RIGHT: 1,
    LEFT: 2
};

const PressureTendency = {
    STEADY: 0,
    RISING: 1,
    FALLING: 2
};

// Conversion Factors
const WEATHER_CONV_MPH_IN_MPS = 2.23693629;
const WEATHER_CONV_KPH_IN_MPS = 3.6;
const WEATHER_CONV_KNOTS_IN_MPS = 1.94384449;

// Soup session (see https://bugzilla.gnome.org/show_bug.cgi?id=661323#c64)
const _httpSession = new Soup.SessionAsync();
Soup.Session.prototype.add_feature.call(_httpSession, new Soup.ProxyResolverDefault());

/* New form of inheritance. */
const WeatherMenuButton = new Lang.Class({
    Name: 'WeatherMenuButton',
    Extends: PanelMenu.Button,

    _init: function() {
        // Load settings
        this._settings = Convenience.getSettings(WEATHER_SETTINGS_SCHEMA);
        this._units = this._settings.get_enum(WEATHER_UNIT_KEY);
        this._wind_speed_units = this._settings.get_enum(WEATHER_WIND_SPEED_UNIT_KEY);
        this._city  = this._settings.get_string(WEATHER_CITY_KEY);
        this._woeid = this._settings.get_string(WEATHER_WOEID_KEY);
        this._translate_condition = this._settings.get_boolean(WEATHER_TRANSLATE_CONDITION_KEY);
        this._show_sunrise = this._settings.get_boolean(WEATHER_SHOW_SUNRISE_SUNSET_KEY);
        this._symbolic_icons = this._settings.get_boolean(WEATHER_USE_SYMBOLIC_ICONS_KEY);
        this._text_in_panel = this._settings.get_boolean(WEATHER_SHOW_TEXT_IN_PANEL_KEY);
        this._position_in_panel = this._settings.get_enum(WEATHER_POSITION_IN_PANEL_KEY);
        this._old_position_in_panel = this._position_in_panel;
        this._comment_in_panel = this._settings.get_boolean(WEATHER_SHOW_COMMENT_IN_PANEL_KEY);
        this._refresh_interval = this._settings.get_int(WEATHER_REFRESH_INTERVAL);

        // Watch settings for changes
        let load_settings_and_refresh_weather = Lang.bind(this, function() {
            this._units = this._settings.get_enum(WEATHER_UNIT_KEY);
            this._wind_speed_units = this._settings.get_enum(WEATHER_WIND_SPEED_UNIT_KEY);
            this._city  = this._settings.get_string(WEATHER_CITY_KEY);
            this._woeid = this._settings.get_string(WEATHER_WOEID_KEY);
            this._translate_condition = this._settings.get_boolean(WEATHER_TRANSLATE_CONDITION_KEY);
            this._show_sunrise = this._settings.get_boolean(WEATHER_SHOW_SUNRISE_SUNSET_KEY);
            this._symbolic_icons = this._settings.get_boolean(WEATHER_USE_SYMBOLIC_ICONS_KEY);
            this._text_in_panel = this._settings.get_boolean(WEATHER_SHOW_TEXT_IN_PANEL_KEY);
            this._comment_in_panel = this._settings.get_boolean(WEATHER_SHOW_COMMENT_IN_PANEL_KEY);
            this.refreshWeather(false);
        });
        this._settings.connect('changed::' + WEATHER_UNIT_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_WIND_SPEED_UNIT_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_CITY_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_WOEID_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_TRANSLATE_CONDITION_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_SHOW_COMMENT_IN_PANEL_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_SHOW_SUNRISE_SUNSET_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_USE_SYMBOLIC_ICONS_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_SHOW_TEXT_IN_PANEL_KEY, load_settings_and_refresh_weather);
        this._settings.connect('changed::' + WEATHER_REFRESH_INTERVAL, Lang.bind(this, function() {
            this._refresh_interval = this._settings.get_int(WEATHER_REFRESH_INTERVAL);
        }));
        /* Allow the position in the panel to change dynamically. */
        this._settings.connect('changed::' + WEATHER_POSITION_IN_PANEL_KEY, Lang.bind(this, function() {
            switch (this._old_position_in_panel) {
            case WeatherPosition.LEFT:
                Main.panel._leftBox.remove_actor(this.actor);
                break;
            case WeatherPosition.CENTER:
                Main.panel._centerBox.remove_actor(this.actor);
                break;
            case WeatherPosition.RIGHT:
                Main.panel._rightBox.remove_actor(this.actor);
                break;
            }
            this._position_in_panel = this._settings.get_enum(WEATHER_POSITION_IN_PANEL_KEY);
            let children = null;
            switch (this._position_in_panel) {
            case WeatherPosition.LEFT:
                children = Main.panel._leftBox.get_children();
                Main.panel._leftBox.insert_child_at_index(this.actor, children.length);
                break;
            case WeatherPosition.CENTER:
                children = Main.panel._centerBox.get_children();
                Main.panel._centerBox.insert_child_at_index(this.actor, children.length);
                break;
            case WeatherPosition.RIGHT:
                children = Main.panel._rightBox.get_children();
                Main.panel._rightBox.insert_child_at_index(this.actor, 0);
                break;
            }
            this._old_position_in_panel = this._position_in_panel;
        }));

        // Panel icon
        this._weatherIcon = new St.Icon({
            icon_name: 'view-refresh-symbolic',
            style_class: 'system-status-icon weather-icon' +
                (Main.panel.actor.get_text_direction() == Clutter.TextDirection.RTL ? '-rtl' : '')
        });

        // Label
        this._weatherInfo = new St.Label({ text: _("...") });

        // Panel menu item - the current class
        let menuAlignment = 0.25;
        if (Clutter.get_default_text_direction() == Clutter.TextDirection.RTL)
            menuAlignment = 1.0 - menuAlignment;
        this.parent(menuAlignment);

        // Putting the panel item together
        let topBox = new St.BoxLayout();
        topBox.add_actor(this._weatherIcon);
        if (this._text_in_panel)
            topBox.add_actor(this._weatherInfo);
        this.actor.add_actor(topBox);
        // We need the box to dynamically change the text in the panel.
        this._topBox = topBox;

        /* I really want to know why I need to reparent the button
           before I can safely insert it in one of the panel
           boxes. */
        let dummyBox = new St.BoxLayout();
        this.actor.reparent(dummyBox);
        dummyBox.remove_actor(this.actor);
        dummyBox.destroy();

        let children = null;
        switch (this._position_in_panel) {
        case WeatherPosition.LEFT:
            children = Main.panel._leftBox.get_children();
            Main.panel._leftBox.insert_child_at_index(this.actor, children.length);
            break;
        case WeatherPosition.CENTER:
            children = Main.panel._centerBox.get_children();
            Main.panel._centerBox.insert_child_at_index(this.actor, children.length);
            break;
        case WeatherPosition.RIGHT:
            children = Main.panel._rightBox.get_children();
            Main.panel._rightBox.insert_child_at_index(this.actor, 0);
            break;
        }

        Main.panel.menuManager.addMenu(this.menu);

        // Current weather
        this._currentWeather = new St.Bin({ style_class: 'current' });
        // Future weather
        this._futureWeather = new St.Bin({ style_class: 'forecast' });

        // Separator (copied from Gnome shell's popupMenu.js)
        this._separatorArea = new St.DrawingArea({ style_class: 'popup-separator-menu-item' });
        this._separatorArea.width = 200;
        this._separatorArea.connect('repaint', Lang.bind(this, this._onSeparatorAreaRepaint));

        // Putting the popup item together
        let mainBox = new St.BoxLayout({ vertical: true });
        mainBox.add_actor(this._currentWeather);
        mainBox.add_actor(this._separatorArea);
        mainBox.add_actor(this._futureWeather);

        this.menu.addActor(mainBox);

        // Items
        this.showLoadingUi();

        this.rebuildCurrentWeatherUi();
        this.rebuildFutureWeatherUi();

        // Show weather
        Mainloop.timeout_add_seconds(3, Lang.bind(this, function() {
            this.refreshWeather(true);
        }));

    },

    unit_to_url: function() {
        return this._units == WeatherUnits.FAHRENHEIT ? 'f' : 'c';
    },

    unit_to_unicode: function() {
        return this._units == WeatherUnits.FAHRENHEIT ? '\u00b0\u0046' : '\u00b0\u0043';
    },

    get_weather_url: function() {
        let server = 'http://query.yahooapis.com/v1/public/yql?format=json&q=';
        let query = 'select link,location,wind,atmosphere,units,'+
            'item.condition,item.forecast,astronomy from weather.forecast '+
            'where location="' + this._woeid + '" and u="' +
            this.unit_to_url() + '"';
        return server + query;
    },

    get_weather_icon: function(code) {
        // see http://developer.yahoo.com/weather/#codetable
        /* fallback icons are: weather-clear-night weather-clear
           weather-few-clouds-night weather-few-clouds weather-fog
           weather-overcast weather-severe-alert weather-showers
           weather-showers-scattered weather-snow weather-storm */
        let symbolic = ((this._symbolic_icons) ? '-symbolic' : '');
        switch (parseInt(code, 10)) {
        case 0: // tornado
            return ['weather-severe-alert' + symbolic];
        case 1: // tropical storm
            return ['weather-severe-alert' + symbolic];
        case 2: // hurricane
            return ['weather-severe-alert' + symbolic];
        case 3: // severe thunderstorms
            return ['weather-severe-alert' + symbolic];
        case 4: // thunderstorms
            return ['weather-storm' + symbolic];
        case 5: // mixed rain and snow
            return ['weather-snow-rain' + symbolic, 'weather-snow' + symbolic];
        case 6: // mixed rain and sleet
            return ['weather-snow-rain' + symbolic, 'weather-snow' + symbolic];
        case 7: // mixed snow and sleet
            return ['weather-snow' + symbolic];
        case 8: // freezing drizzle
            return ['weather-freezing-rain' + symbolic, 'weather-showers' + symbolic];
        case 9: // drizzle
            return ['weather-fog' + symbolic];
        case 10: // freezing rain
            return ['weather-freezing-rain' + symbolic, 'weather-showers' + symbolic];
        case 11: // showers
            return ['weather-showers' + symbolic];
        case 12: // showers
            return ['weather-showers' + symbolic];
        case 13: // snow flurries
            return ['weather-snow' + symbolic];
        case 14: // light snow showers
            return ['weather-snow' + symbolic];
        case 15: // blowing snow
            return ['weather-snow' + symbolic];
        case 16: // snow
            return ['weather-snow' + symbolic];
        case 17: // hail
            return ['weather-snow' + symbolic];
        case 18: // sleet
            return ['weather-snow' + symbolic];
        case 19: // dust
            return ['weather-fog' + symbolic];
        case 20: // foggy
            return ['weather-fog' + symbolic];
        case 21: // haze
            return ['weather-fog' + symbolic];
        case 22: // smoky
            return ['weather-fog' + symbolic];
        case 23: // blustery
            return ['weather-few-clouds' + symbolic];
        case 24: // windy
            return ['weather-few-clouds' + symbolic];
        case 25: // cold
            return ['weather-few-clouds' + symbolic];
        case 26: // cloudy
            return ['weather-overcast' + symbolic];
        case 27: // mostly cloudy (night)
            return ['weather-clouds-night' + symbolic, 'weather-few-clouds-night' + symbolic];
        case 28: // mostly cloudy (day)
            return ['weather-clouds' + symbolic, 'weather-overcast' + symbolic];
        case 29: // partly cloudy (night)
            return ['weather-few-clouds-night' + symbolic];
        case 30: // partly cloudy (day)
            return ['weather-few-clouds' + symbolic];
        case 31: // clear (night)
            return ['weather-clear-night' + symbolic];
        case 32: // sunny
            return ['weather-clear' + symbolic];
        case 33: // fair (night)
            return ['weather-clear-night' + symbolic];
        case 34: // fair (day)
            return ['weather-clear' + symbolic];
        case 35: // mixed rain and hail
            return ['weather-snow-rain' + symbolic, 'weather-showers' + symbolic];
        case 36: // hot
            return ['weather-clear' + symbolic];
        case 37: // isolated thunderstorms
            return ['weather-storm' + symbolic];
        case 38: // scattered thunderstorms
            return ['weather-storm' + symbolic];
        case 39: // http://developer.yahoo.com/forum/YDN-Documentation/Yahoo-Weather-API-Wrong-Condition-Code/1290534174000-1122fc3d-da6d-34a2-9fb9-d0863e6c5bc6
        case 40: // scattered showers
            return ['weather-showers-scattered' + symbolic, 'weather-showers' + symbolic];
        case 41: // heavy snow
            return ['weather-snow' + symbolic];
        case 42: // scattered snow showers
            return ['weather-snow' + symbolic];
        case 43: // heavy snow
            return ['weather-snow' + symbolic];
        case 44: // partly cloudy
            return ['weather-few-clouds' + symbolic];
        case 45: // thundershowers
            return ['weather-storm' + symbolic];
        case 46: // snow showers
            return ['weather-snow' + symbolic];
        case 47: // isolated thundershowers
            return ['weather-storm' + symbolic];
        case 3200: // not available
        default:
            return ['weather-severe-alert' + symbolic];
        }
    },

    get_weather_icon_safely: function(code) {
        let iconname = this.get_weather_icon(code);
        for (let i = 0; i < iconname.length; i++) {
            if (this.has_icon(iconname[i]))
                return iconname[i];
        }
        return 'weather-severe-alert';
     },

    has_icon: function(icon) {
        return  Gtk.IconTheme.get_default().has_icon(icon);
    },

    get_weather_condition: function(code) {
        switch (parseInt(code, 10)){
        case 0: // tornado
            return _("Tornado");
        case 1: // tropical storm
            return _("Tropical storm");
        case 2: // hurricane
            return _("Hurricane");
        case 3: // severe thunderstorms
            return _("Severe thunderstorms");
        case 4: // thunderstorms
            return _("Thunderstorms");
        case 5: // mixed rain and snow
            return _("Mixed rain and snow");
        case 6: // mixed rain and sleet
            return _("Mixed rain and sleet");
        case 7: // mixed snow and sleet
            return _("Mixed snow and sleet");
        case 8: // freezing drizzle
            return _("Freezing drizzle");
        case 9: // drizzle
            return _("Drizzle");
        case 10: // freezing rain
            return _("Freezing rain");
        case 11: // showers
            return _("Showers");
        case 12: // showers
            return _("Showers");
        case 13: // snow flurries
            return _("Snow flurries");
        case 14: // light snow showers
            return _("Light snow showers");
        case 15: // blowing snow
            return _("Blowing snow");
        case 16: // snow
            return _("Snow");
        case 17: // hail
            return _("Hail");
        case 18: // sleet
            return _("Sleet");
        case 19: // dust
            return _("Dust");
        case 20: // foggy
            return _("Foggy");
        case 21: // haze
            return _("Haze");
        case 22: // smoky
            return _("Smoky");
        case 23: // blustery
            return _("Blustery");
        case 24: // windy
            return _("Windy");
        case 25: // cold
            return _("Cold");
        case 26: // cloudy
            return _("Cloudy");
        case 27: // mostly cloudy (night)
        case 28: // mostly cloudy (day)
            return _("Mostly cloudy");
        case 29: // partly cloudy (night)
        case 30: // partly cloudy (day)
            return _("Partly cloudy");
        case 31: // clear (night)
            return _("Clear");
        case 32: // sunny
            return _("Sunny");
        case 33: // fair (night)
        case 34: // fair (day)
            return _("Fair");
        case 35: // mixed rain and hail
            return _("Mixed rain and hail");
        case 36: // hot
            return _("Hot");
        case 37: // isolated thunderstorms
            return _("Isolated thunderstorms");
        case 38: // scattered thunderstorms
        case 39: // scattered thunderstorms
            return _("Scattered thunderstorms");
        case 40: // scattered showers
            return _("Scattered showers");
        case 41: // heavy snow
            return _("Heavy snow");
        case 42: // scattered snow showers
            return _("Scattered snow showers");
        case 43: // heavy snow
            return _("Heavy snow");
        case 44: // partly cloudy
            return _("Partly cloudy");
        case 45: // thundershowers
            return _("Thundershowers");
        case 46: // snow showers
            return _("Snow showers");
        case 47: // isolated thundershowers
            return _("Isolated thundershowers");
        case 3200: // not available
        default:
            return _("Not available");
        }
    },

    parse_day: function(abr) {
        let yahoo_days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        for (var i = 0; i < yahoo_days.length; i++) {
            if (yahoo_days[i].substr(0, abr.length) == abr.toLowerCase()) {
                return i;
            }
        }
        return 0;
    },

    get_locale_day: function(abr) {
        let days = [_("Monday"), _("Tuesday"), _("Wednesday"), _("Thursday"), _("Friday"), _("Saturday"), _("Sunday")];
        return days[this.parse_day(abr)];
    },

    get_compass_direction: function(deg) {
        let directions = [_("N"), _("NE"), _("E"), _("SE"), _("S"), _("SW"), _("W"), _("NW")];
        return directions[Math.round(deg / 45) % directions.length];
    },

    get_pressure_state : function(state) {
	switch(parseInt(state, 3)) {
	case PressureTendency.STEADY:
	    return '\u2933';
	    break;

	case  PressureTendency.RISING:
	    return '\u2934';
	    break;

	case  PressureTendency.FALLING:
	    return '\u2935';
	    break;
	}
        /* Should not be reached. */
        return '\u2933';
    },

    load_json_async: function(url, fun) {
        let here = this;

        let message = Soup.Message.new('GET', url);
        _httpSession.queue_message(message, function(session, message) {
            let jp = new Json.Parser();
            jp.load_from_data(message.response_body.data, -1);
            fun.call(here, jp.get_root().get_object());
        });
    },

    refreshWeather: function(recurse) {
        this.load_json_async(this.get_weather_url(), function(json) {

            try {
                let weather = json.get_object_member('query').get_object_member('results').get_object_member('channel');
                let weather_c = weather.get_object_member('item').get_object_member('condition');
                let forecast = weather.get_object_member('item').get_array_member('forecast').get_elements();

                let location = weather.get_object_member('location').get_string_member('city');
                if (this._city != null && this._city.length > 0)
                    location = this._city;

                // Refresh current weather
                let comment = weather_c.get_string_member('text');
                if (this._translate_condition)
                    comment = this.get_weather_condition(weather_c.get_string_member('code'));

                let temperature = weather_c.get_string_member('temp');
                let chill =  weather.get_object_member('wind').get_string_member('chill');
                let humidity = weather.get_object_member('atmosphere').get_string_member('humidity') + ' %';
                let pressure = weather.get_object_member('atmosphere').get_string_member('pressure');
                let pressure_state = weather.get_object_member('atmosphere').get_string_member('rising');
                let pressure_unit = weather.get_object_member('units').get_string_member('pressure');
                let wind_direction = this.get_compass_direction(weather.get_object_member('wind').get_string_member('direction'));
                let wind = weather.get_object_member('wind').get_string_member('speed');
                let wind_unit = weather.get_object_member('units').get_string_member('speed');
                let iconname = this.get_weather_icon_safely(weather_c.get_string_member('code'));
                let sunrise = this._show_sunrise ? weather.get_object_member('astronomy').get_string_member('sunrise') : '';
                let sunset = this._show_sunrise ? weather.get_object_member('astronomy').get_string_member('sunset') : '';
                this._currentWeatherIcon.icon_name = this._weatherIcon.icon_name = iconname;

                if (this._comment_in_panel)
                    this._weatherInfo.text = (comment + ', ' + temperature + ' ' + this.unit_to_unicode());
                else
                    this._weatherInfo.text = (temperature + ' ' + this.unit_to_unicode());

                this._currentWeatherSummary.text = comment + ', ' + temperature + ' ' + this.unit_to_unicode();
                this._currentWeatherChill.text = chill + ' ' + this.unit_to_unicode();
                this._currentWeatherHumidity.text = humidity;
                this._currentWeatherPressure.text = pressure + ' ' + pressure_unit + ((pressure_state) ? ' ' : '') + this.get_pressure_state(pressure_state);

                if (wind) {
                    // Override wind units with our preference
                    // Need to consider what units the Yahoo API has returned it in
                    switch (this._wind_speed_units) {
                    case WeatherWindSpeedUnits.KPH:
                        // Round to whole units
                        if (this._units == WeatherUnits.FAHRENHEIT) {
                            wind = Math.round (wind / WEATHER_CONV_MPH_IN_MPS * WEATHER_CONV_KPH_IN_MPS);
                            wind_unit = 'km/h';
                        }
                        // Otherwise no conversion needed - already in correct units
                        break;
                    case WeatherWindSpeedUnits.MPH:
                        // Round to whole units
                        if (this._units == WeatherUnits.CELSIUS) {
                            wind = Math.round (wind / WEATHER_CONV_KPH_IN_MPS * WEATHER_CONV_MPH_IN_MPS);
                            wind_unit = 'mph';
                        }
                        // Otherwise no conversion needed - already in correct units
                        break;
                    case WeatherWindSpeedUnits.MPS:
                        // Precision to one decimal place as 1 m/s is quite a large unit
                        if (this._units == WeatherUnits.CELSIUS)
                            wind = Math.round ((wind / WEATHER_CONV_KPH_IN_MPS) * 10)/ 10;
                        else
                            wind = Math.round ((wind / WEATHER_CONV_MPH_IN_MPS) * 10)/ 10;
                        wind_unit = 'm/s';
                        break;
                    case WeatherWindSpeedUnits.KNOTS:
                        // Round to whole units
                        if (this._units == WeatherUnits.CELSIUS)
                            wind = Math.round (wind / WEATHER_CONV_KPH_IN_MPS * WEATHER_CONV_KNOTS_IN_MPS);
                        else
                            wind = Math.round (wind / WEATHER_CONV_MPH_IN_MPS * WEATHER_CONV_KNOTS_IN_MPS);
                        wind_unit = 'knots';
                        break;
                    }
                    this._currentWeatherWind.text = (wind_direction && wind > 0 ? wind_direction + ' ' : '') + wind + ' ' + wind_unit;
                } else {
                    this._currentWeatherWind.text = '\u2013';
                }

                this._currentWeatherLocation.label = location + '...';
                // make the location act like a button
                this._currentWeatherLocation.style_class = 'weather-current-location-link';
                this._currentWeatherLocation.url = weather.get_string_member('link');
                if (this._show_sunrise) {
                    if (this._sunrise_actor == null) {
                        this._sunrise_actor = this.createSunriseSunsetLabels();
                        this._sunrise_box.add_actor(this._sunrise_actor);
                    }
                    this._currentWeatherSunrise.text = sunrise.toUpperCase();
                    this._currentWeatherSunset.text = sunset.toUpperCase();
                } else {
                    if (this._sunrise_actor != null) {
                        this._sunrise_actor.destroy();
                        this._sunrise_actor = null;
                    }
                }
                // Refresh forecast
                let date_string = [_("Today"), _("Tomorrow")];
                for (let i = 0; i <= 1; i++) {
                    let forecastUi = this._forecast[i];
                    let forecastData = forecast[i].get_object();

                    let code = forecastData.get_string_member('code');
                    let t_low = forecastData.get_string_member('low');
                    let t_high = forecastData.get_string_member('high');

                    let comment = forecastData.get_string_member('text');
                    if (this._translate_condition)
                        comment = this.get_weather_condition(code);

                    forecastUi.Day.text = date_string[i] + ' (' + this.get_locale_day(forecastData.get_string_member('day')) + ')';
                    forecastUi.Temperature.text = t_low + ' \u2013 ' + t_high + ' ' + this.unit_to_unicode();
                    forecastUi.Summary.text = comment;
                    forecastUi.Icon.icon_name = this.get_weather_icon_safely(code);
                }
                if (this._text_in_panel) {
                    if (!this._topBox.contains(this._weatherInfo))
                        this._topBox.add_actor(this._weatherInfo);
                } else if (this._topBox.contains(this._weatherInfo)) {
                    this._topBox.remove_actor(this._weatherInfo);
                }

            } catch(e) {
                global.log('A ' + e.name + ' has occured: ' + e.message);
            }
        });

        // Repeatedly refresh weather if recurse is set
        if (recurse) {
            Mainloop.timeout_add_seconds(this._refresh_interval, Lang.bind(this, function() {
                this.refreshWeather(true);
            }));
        }

    },

    destroyCurrentWeather: function() {
        if (this._currentWeather.get_child() != null)
            this._currentWeather.get_child().destroy();
    },

    destroyFutureWeather: function() {
        if (this._futureWeather.get_child() != null)
            this._futureWeather.get_child().destroy();
    },

    showLoadingUi: function() {
        this.destroyCurrentWeather();
        this.destroyFutureWeather();
        this._currentWeather.set_child(new St.Label({ text: _("Loading current weather ...") }));
        this._futureWeather.set_child(new St.Label({ text: _("Loading future weather ...") }));
    },

    createSunriseSunsetLabels: function() {
        this._currentWeatherSunrise = new St.Label({ text: '-' });
        this._currentWeatherSunset = new St.Label({ text: '-' });

        let ab = new St.BoxLayout({
            style_class: 'weather-current-astronomy'
        });

        let ab_sunriselabel = new St.Label({ text: _("Sunrise") + ': ' });
        let ab_spacerlabel = new St.Label({ text: '   ' });
        let ab_sunsetlabel = new St.Label({ text: _("Sunset") + ': ' });

        ab.add_actor(ab_sunriselabel);
        ab.add_actor(this._currentWeatherSunrise);
        ab.add_actor(ab_spacerlabel);
        ab.add_actor(ab_sunsetlabel);
        ab.add_actor(this._currentWeatherSunset);

        return ab;
    },

    rebuildCurrentWeatherUi: function() {
        this.destroyCurrentWeather();

        // This will hold the icon for the current weather
        this._currentWeatherIcon = new St.Icon({
            icon_size: 64,
            icon_name: 'view-refresh-symbolic',
            style_class: 'weather-current-icon'
        });

        // The summary of the current weather
        this._currentWeatherSummary = new St.Label({
            text: _("Loading ..."),
            style_class: 'weather-current-summary'
        });

        // The location name and link to the details page
        this._currentWeatherLocation = new St.Button({ reactive: true,
                                                   label: _("Please wait") });
        this._currentWeatherLocation.connect('clicked', Lang.bind(this, function() {
            if (this._currentWeatherLocation.url == null)
                return;
            Gio.app_info_launch_default_for_uri(
                    this._currentWeatherLocation.url,
                    global.create_app_launch_context());
            this.menu.close(true);
        }));

        let bb = new St.BoxLayout({
            vertical: true,
            style_class: 'weather-current-summarybox'
        });

        bb.add_actor(this._currentWeatherLocation);
        bb.add_actor(this._currentWeatherSummary);

        this._sunrise_actor = null;
        if (this._show_sunrise) {
            this._sunrise_actor = this.createSunriseSunsetLabels();
            bb.add_actor(this._sunrise_actor);
        }
        /* We need the box so we can destroy/create the labels when
           the user wants to. */
        this._sunrise_box = bb;
        // Other labels
        this._currentWeatherChill = new St.Label({ text: '...' });
        this._currentWeatherHumidity = new St.Label({ text:  '...' });
        this._currentWeatherPressure = new St.Label({ text: '...' });
        this._currentWeatherWind = new St.Label({ text: '...' });

        let rb = new St.BoxLayout({
            style_class: 'weather-current-databox'
        });
        let rb_captions = new St.BoxLayout({
            vertical: true,
            style_class: 'weather-current-databox-captions'
        });
        let rb_values = new St.BoxLayout({
            vertical: true,
            style_class: 'weather-current-databox-values'
        });
        rb.add_actor(rb_captions);
        rb.add_actor(rb_values);

        rb_captions.add_actor(new St.Label({text: _("Wind chill:")}));
        rb_values.add_actor(this._currentWeatherChill);
        rb_captions.add_actor(new St.Label({text: _("Humidity:")}));
        rb_values.add_actor(this._currentWeatherHumidity);
        rb_captions.add_actor(new St.Label({text: _("Pressure:")}));
        rb_values.add_actor(this._currentWeatherPressure);
        rb_captions.add_actor(new St.Label({text: _("Wind:")}));
        rb_values.add_actor(this._currentWeatherWind);

        let xb = new St.BoxLayout();
        xb.add_actor(bb);
        xb.add_actor(rb);

        let box = new St.BoxLayout({
            style_class: 'weather-current-iconbox'
        });
        box.add_actor(this._currentWeatherIcon);
        box.add_actor(xb);
        this._currentWeather.set_child(box);

    },

    rebuildFutureWeatherUi: function() {
        this.destroyFutureWeather();

        this._forecast = [];
        this._forecastBox = new St.BoxLayout();
        this._futureWeather.set_child(this._forecastBox);

        for (let i = 0; i <= 1; i++) {
            let forecastWeather = {};

            forecastWeather.Icon = new St.Icon({
                icon_size: 48,
                icon_name: 'view-refresh-symbolic',
                style_class: 'weather-forecast-icon'
            });
            forecastWeather.Day = new St.Label({
                style_class: 'weather-forecast-day'
            });
            forecastWeather.Summary = new St.Label({
                style_class: 'weather-forecast-summary'
            });
            forecastWeather.Temperature = new St.Label({
                style_class: 'weather-forecast-temperature'
            });

            let by = new St.BoxLayout({
                vertical: true,
                style_class: 'weather-forecast-databox'
            });
            by.add_actor(forecastWeather.Day);
            by.add_actor(forecastWeather.Summary);
            by.add_actor(forecastWeather.Temperature);

            let bb = new St.BoxLayout({
                style_class: 'weather-forecast-box'
            });
            bb.add_actor(forecastWeather.Icon);
            bb.add_actor(by);

            this._forecast[i] = forecastWeather;
            this._forecastBox.add_actor(bb);

        }

    },

    // Copied from Gnome shell's popupMenu.js
    _onSeparatorAreaRepaint: function(area) {
        let cr = area.get_context();
        let themeNode = area.get_theme_node();
        let [width, height] = area.get_surface_size();
        let margin = themeNode.get_length('-margin-horizontal');
        let gradientHeight = themeNode.get_length('-gradient-height');
        let startColor = themeNode.get_color('-gradient-start');
        let endColor = themeNode.get_color('-gradient-end');

        let gradientWidth = (width - margin * 2);
        let gradientOffset = (height - gradientHeight) / 2;
        let pattern = new Cairo.LinearGradient(margin, gradientOffset, width - margin, gradientOffset + gradientHeight);
        pattern.addColorStopRGBA(0, startColor.red / 255, startColor.green / 255, startColor.blue / 255, startColor.alpha / 255);
        pattern.addColorStopRGBA(0.5, endColor.red / 255, endColor.green / 255, endColor.blue / 255, endColor.alpha / 255);
        pattern.addColorStopRGBA(1, startColor.red / 255, startColor.green / 255, startColor.blue / 255, startColor.alpha / 255);
        cr.setSource(pattern);
        cr.rectangle(margin, gradientOffset, gradientWidth, gradientHeight);
        cr.fill();
    }
});

let weatherMenu;

function init() {
    Convenience.initTranslations('gnome-shell-extension-weather');
}

function enable() {
    weatherMenu = new WeatherMenuButton();
    Main.panel.addToStatusArea('weatherMenu', weatherMenu);
}

function disable() {
    weatherMenu.destroy();
}

// vim:set ts=4 sw=4 et:
