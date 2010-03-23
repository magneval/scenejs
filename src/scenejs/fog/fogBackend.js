/**
 * Backend that manages scene fog.
 *
 *
 */
SceneJS._backends.installBackend(

        "fog",

        function(ctx) {

            var fog;
            var dirty;

            function colourToArray(v, fallback) {
                return v ?
                       [
                           v.r != undefined ? v.r : fallback[0],
                           v.g != undefined ? v.g : fallback[1],
                           v.b != undefined ? v.b : fallback[2]
                       ] : fallback;
            }

            function _createFog(f) {
                if (f.mode &&
                    (f.mode != "exp"
                            && f.mode != "exp2"
                            && f.mode != "linear")) {
                    throw SceneJS.exceptions.InvalidNodeConfigException(
                            "SceneJS.fog node has a mode of unsupported type - should be 'exp', 'exp2' or 'linear'");
                }
                return {
                    color: colourToArray(f.color, [ 0.5,  0.5, 0.5 ]),
                    mode: f.mode || "exp",
                    density: f.density || 1.0,
                    start: f.start || 0,
                    end: f.end || 1.0
                };
            }

            ctx.events.onEvent(
                    SceneJS._eventTypes.SCENE_ACTIVATED,
                    function() {
                        _createFog({});
                        dirty = true;
                    });

            ctx.events.onEvent(
                    SceneJS._eventTypes.SHADER_ACTIVATED,
                    function() {
                        dirty = true;
                    });

            ctx.events.onEvent(
                    SceneJS._eventTypes.SHADER_RENDERING,
                    function() {
                        if (dirty) {
                            ctx.events.fireEvent(
                                    SceneJS._eventTypes.FOG_EXPORTED,
                                    fog);
                            dirty = false;
                        }
                    });

            ctx.events.onEvent(
                    SceneJS._eventTypes.SHADER_DEACTIVATED,
                    function() {
                        dirty = true;
                    });


            /* Node-facing API
             */
            return {

                setFog : function(f) {
                    fog = f ? _createFog(f) : null;
                    dirty = true;
                    ctx.events.fireEvent(
                            SceneJS._eventTypes.FOG_UPDATED,
                            fog);
                },

                getFog : function() {
                    return fog;
                }
            };
        });
