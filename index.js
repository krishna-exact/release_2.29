const { read } = require("fs");
const { config } = require("process");
const propertiesReader = require('properties-reader');
const properties = propertiesReader(__dirname + "\\config.properties");
let restart_time = Number(properties.get("RESTART_TIME"));
var responseTime=0;
let network_status=1;
let restart=0;
if (isNaN(restart_time) || restart_time === 0) {
  restart_time = 6; // 
}

console.log(properties.get("MQTT_URL"))
console.log(__dirname + "\config.properties")

function statusCodesToCause(code) {
    const statusCodes = {
        "0": "Connecting",
        "1": "Success",
        "2": "Unable to upload to database",
        "3": "Program Stopped"
    }
    return statusCodes[code.toString()]
}

function statusCauseToCodes(cause) {
    const statusCauses = {
        "Connecting": 0,
        "Success": 1,
        "Unable to upload to database": 2,
        "Program Stopped": 3
    }

    return statusCodes[cause]

}

function lookKeyToIndex(obj, key, match) {
    for (var i = 0; i < obj.length; i++) {
        if (obj[i][key] == match) {
            return i;
        }
    }
    return -1;
}

function validateStatusOfAllConfigs(arr) {
    // console.log("every")
    // console.log(arr.every( (val, i, arr) => val === 1 )  )
    return arr.every((val, i, arr) => val === 1)   // true
}

function validateStaleOfAllConfigs(arr) {
    return false
}

function isStaleTimestamp(ts, configId) {
    // right now - status timestamp
    console.log('time: ',restart_time)
    var tmp = ((+(new Date()) - (new Date(ts))) / 60000)
    console.log(configId, ts, tmp)
    // console.log("stale")
    return tmp > restart_time ? true : false
}

function csvJSON(csv) {

    var lines = csv.split("\n");

    var result = [];

    var headers = lines[0].split(",");

    for (var i = 1; i < lines.length; i++) {

        var obj = {};
        var currentline = lines[i].split(",");

        for (var j = 0; j < headers.length; j++) {
            obj[headers[j].replace("\r", "")] = currentline[j].replace("\r", "");
        }

        result.push(obj);

    }

    return JSON.stringify(result); //JSON
}

function hasTagsColumnAndNonEmpty(tags) {
    return tags.filter(function (tag) {
        if (tag["tags"]) {
            tag["dataTagId"] = tag["tags"]
            delete tag["tags"]
            return tag
        }
    });
}

function authenticate($http, $scope) {
    return $http({
        "url": properties.get("CONFIG_URL_PREFIX") + "/Users/login",
        "headers": {
            "content-type": "application/json;charset=UTF-8",
        },
        "data": "{\"email\":\"" + properties.get("API_AUTH_USERNAME") + "\",\"password\":\"" + properties.get("API_AUTH_PASSWORD") + "\"}",
        "method": "POST"
    })

}
let restart_interval = Number(properties.get("RESTART_INTERVAL"));
if (isNaN(restart_interval) || restart_interval === 0) {
  restart_interval = 1; // 
}

let max_attempts= Number(properties.get("MAX_ATTEMPTS"));
if (isNaN(max_attempts) || max_attempts === 0) {
    max_attempts = 5; // 
  }
let backoff_interval= Number(properties.get("BACKOFF_INTERVAL"));
if (isNaN(backoff_interval) || backoff_interval=== 0) {
    backoff_interval = 5; // 
  }

var attempts = 1;
var inBackoffPeriod = false;
var backoffEndTime = 0;

function manageRestart($http, $scope, configId, index) {
    var clientId = localStorage.getItem("clientId") || $scope.clientId;
    var currentTime = Date.now();
    var lastRestartTime = parseInt(localStorage.getItem(configId + "_last_restart_time")) || 0;
    if (inBackoffPeriod && currentTime < backoffEndTime) {
        console.log("Backoff period time");
        return;
    } else if (inBackoffPeriod && currentTime >= backoffEndTime) {
        console.log("Backoff period over, resetting attempts");
        attempts = 1;
        inBackoffPeriod = false;
    }
    
    if (attempts > max_attempts && !inBackoffPeriod) {
        console.log("Maximum restart attempts reached. Backing off for " + backoff_interval + " minutes.");
        inBackoffPeriod = true;
        backoffEndTime = currentTime + (backoff_interval * 60 * 1000);
        return;
    }
    
    if ((currentTime - lastRestartTime) < (restart_interval * 60 * 1000)) {
        console.log("Restart interval not elapsed yet.");
        return;
    }
    
    $http.get(properties.get("CONFIG_URL_PREFIX") + "/ingestconfigs/" + configId + "/statuses")
        .then(function (res) {
            if (res.status == 200) {
                //remote restart
                console.log("configId", configId, "requiredRestart", res.data["requireRestart"], "status", res.data["status"], "url", properties.get("CONFIG_URL_PREFIX") + "/ingestconfigs/" + configId + "/statuses");
              
                if(res.data["status"]===1){
                    network_status=1;
                }
                else network_status=0;
                if (res.data["requireRestart"]) {
                    restart=1;
                    console.log("Required Restart Detected")
                    $http.post(properties.get("CONFIG_URL_PREFIX") + '/statuses/update?where={"ingestconfigId":"' + configId + '"}', json = { "requireRestart": false })
                        .then(function (response) {
                            if (response.status == 200) {
                                console.log("Required Restart Requested")
                                $scope.restart(configId)
                                console.log("Restarted-Attempts:",attempts)
                                localStorage.setItem(configId + "_last_restart_time", Date.now());
                                attempts++;
                            } else {
                                console.error(response.status)
                            }
                        }).catch(function (response) {
                            console.error(response)
                        });

                } else if (res.data["time"] && isStaleTimestamp(res.data["time"], configId)) {
                    console.log("Stale condition detected");
                    if (attempts <= max_attempts) {
                        console.log("Restarting");
                        $scope.restart(configId);
                        console.log("Restarted- Attempts:",attempts);
                        localStorage.setItem(configId + "_last_restart_time", Date.now());
                        attempts++;
                    } else {
                        console.log("Maximum restart attempts reached. Backing off for " + backoff_interval + " minutes.");
                        inBackoffPeriod = true;
                        backoffEndTime = currentTime + (backoff_interval * 60 * 1000);
                    }
                } else {
                    restart=0;
                    console.log("No restart required.");
                }
                var d = new Date();
                var epochTime = d.getTime();
                console.log(clientId+"/"+configId + "/"+configId+"_network_status")
                console.log(clientId+"/"+configId + "/"+configId+"_restart")
                mq.publish(clientId+"/"+configId + "/"+configId+"_network_status",JSON.stringify({ "t": epochTime, "v": network_status }))  
                mq.publish(clientId+"/"+configId + "/"+configId+"_restart",JSON.stringify({ "t": epochTime, "v":restart})) 
      
                $scope.forms[index]["status"] = statusCodesToCause(res.data["status"])
                $scope.forms[index].status_class = (res.data["status"] == 1) ? "success" : "error";
            }
        })
        .catch(function (e2) {
            console.error(configId, e2)
        });
}


angular.module('desktopApp', [])
    .controller('indexController', function ($scope, $http, $interval) {
        $scope.network = false
        $scope.registration = true
        $scope.config = false

        $scope.dataTagIds = []
        $scope.TagsRender = {}

        $scope.TsRender = {}

        // authenticate($http, ()=>{
        $http.defaults.headers.common['Authorization'] = $scope.auth_token
        // })


        $scope.onMessageCallback = function (topic, msg) {
            // console.log("updates tags")
            var dataTagId = topic.split("/")[2]
            // console.log(dataTagId)
            // console.log(msg.toString())["v"]
            let d = new Date(JSON.parse(msg.toString())["t"])

            $scope.TagsRender[dataTagId] = JSON.parse(msg.toString())["v"];
            // $scope.TsRender[dataTagId] =  d.getDate()  + "-" + (d.getMonth()+1) + " "  +d.getHours() + ":" + d.getMinutes();
            $scope.TsRender[dataTagId] = d.toLocaleString("en-US") //d.getDate()  + "-" + (d.getMonth()+1) + " "  +d.getHours() + ":" + d.getMinutes();
            // console.log("onmessage")
            // console.log($scope[dataTagId])
        }


        mq = mqtt.connect(properties.get("MQTT_URL"), { keepalive: 120, username: properties.get("MQTT_AUTH_USERNAME"), password: properties.get("MQTT_AUTH_PASSWORD") });
        mq.on("message", $scope.onMessageCallback);

        $scope.start = function (configId) {
            console.log(configId)
            console.log("Calling start")
            start(configId)
            localStorage.setItem(configId, true)
        }

        $scope.stop = function (configId) {
            console.log(configId)
            console.log("Calling stop")
            stop(configId)
            localStorage.removeItem(configId);
            $http.post(properties.get("CONFIG_URL_PREFIX") + '/statuses/update?where={"ingestconfigId":"' + configId + '"}', json = { "status": 3 })
                .then(function (response) {
                    console.log(response.status)
                    if (response.status == 200) {
                        console.log("status went to stop")
                        // $scope.forms[0].config_msg = 'Saved!'
                        // $scope.forms[formindex].status = 'Saved'
                        console.log(response.data.count)
                        if (response.data.count == 0 || response.status != 200) {
                            console.log("Not found configs, in post statuses update")
                            $http.post(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + configId + '/statuses', json = { "status": 0 })
                                .then(function (response) {
                                    if (response.status == 200) {
                                        console.log("created status")
                                    } else {
                                        console.error(response.status)
                                    }
                                }).catch(function (response) {
                                    console.error(response)
                                });
                        }
                    } else {
                        // console.error("Form save")
                        console.error(response.status)
                        // $scope.config_msg[0] = "Cloud error ",reponse.status 
                        // $scope.forms[formindex].status = 'Cloud error'
                    }
                }).catch(function (e2) {
                    console.error(e2)
                });
            // var index = lookKeyToIndex($scope.forms, "id", configId)
            // $scope.forms[index]["status"] = "Program Stopped"

            // $scope.forms[index].status_class = "error"
            // $scope.config_color = 'red';
        }

        $scope.restart = function (configId) {
            console.log(configId)
            console.log("Calling stop")
            stop(configId)
            localStorage.removeItem(configId);
            $http.post(properties.get("CONFIG_URL_PREFIX") + '/statuses/update?where={"ingestconfigId":"' + configId + '"}', json = { "status": 3 })
                .then(function (response) {
                    console.log(response.status)
                    if (response.status == 200) {
                        console.log("updated status for stop")
                        // $scope.forms[0].config_msg = 'Saved!'
                        // $scope.forms[formindex].status = 'Saved'
                        // console.log(response.data.count)
                        console.log("created status")
                        $scope.start(configId)
                       //console.log("restart done")
                    } else if (response.data.count == 0 || response.status != 200) {
                        console.log("Not found configs, in post statuses update")
                        $http.post(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + configId + '/statuses', json = { "status": 0 })
                            .then(function (response) {
                                if (response.status == 200) {
                                    console.log(response.status)
                                } else {
                                    console.error(response.status)
                                }
                            }).catch(function (response) {
                                console.error(response)
                            });
                    } else {
                        // console.error("Form save")
                        console.error(response.status)
                        // $scope.config_msg[0] = "Cloud error ",reponse.status 
                        // $scope.forms[formindex].status = 'Cloud error'
                    }
                }).catch(function (e2) {
                    console.error(e2)
                });
            // var index = lookKeyToIndex($scope.forms, "id", configId)
            // $scope.forms[index]["status"] = "Program Stopped"

            // $scope.forms[index].status_class = "error"
            // $scope.config_color = 'red';
        }
        $scope.stopAll = function () {
            console.log("stopping all")
            var clientId = localStorage.getItem("clientId") || $scope.clientId;
            $http.get(properties.get("CONFIG_URL_PREFIX") + "/clients/" + clientId + "/ingestconfigs")
                .then(function (response) {
                    if (response.status == 200) {
                        console.log("got all configs to delete!")
                        for (var i = 0; i < response.data.length; i++) {
                            localStorage.removeItem(response.data[i]["id"]);
                        }
                        stopAll()
                    } else {
                        console.error(response.status)
                    }
                }).catch(function (response) {
                    console.error(response)
                });

        }


        $scope.addCSV = function (form) {
            if (document.getElementById('file').files.length == 0) {
                console.log("no files")
                return
            }
            console.log("fileame")
            // if (f)
            var f = document.getElementById('file').files[0],
                r = new FileReader();
            console.log(f.name);

            // resetting array
            // document.getElementById('file').files = ""
            // document.getElementById("csvChoose").innerHTML = f.name;


            if (!f.name.endsWith(".csv")) {
                alert(f.name + " is not a CSV file")
                return
            }


            r.onloadend = function (e) {
                var data = e.target.result;
                // console.log("csv data")

                try {
                    var taglist = JSON.parse(csvJSON(data))
                    // console.log(taglist)

                    taglist = hasTagsColumnAndNonEmpty(taglist)
                    if (taglist.length > 0) {
                        $http.post(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + form.id + '/tags', json = taglist)
                            .then(function (response) {
                                if (response.status == 200) {
                                    console.log("saved!")
                                    // $scope.forms[0].config_msg = 'Saved!'
                                    // $scope.forms[formindex].status = 'Saved'
                                    // console.log(form.newTag)
                                    form.tags.concat(taglist)
                                    // form.tags.push({"dataTagId":form.newTag, "ingestconfigId": form.id})

                                } else {
                                    // console.error("Form save")
                                    console.error(response.status)
                                    // $scope.config_msg[0] = "Cloud error ",reponse.status 
                                    // $scope.forms[formindex].status = 'Cloud error'
                                }

                            }).catch(function (response) {
                                console.error(response)
                            });
                    } else {
                        alert("CSV must contain `tags` column and value should not be empty")
                    }
                }
                catch (err) {
                    console.log("Internal error: CSV Parsing")
                    console.log(err)
                    // alert("CSV Par: Internal Error")
                }
                // console.log(data)
                //send your binary data via $http or $resource or do anything else with it
            }

            r.readAsBinaryString(f);
        }

        $scope.lget = function (arg) {
            return localStorage.getItem(arg)
        }

        $scope.test = function (form) {
            console.log(form)
            test(form)
        }

        $scope.loadTags = function (form) {
            var clientId = localStorage.getItem("clientId") || $scope.clientId;

            const local_config = form
            console.log(clientId + "/" + local_config["id"])
            $http.get(properties.get("CONFIG_URL_PREFIX") + "/ingestconfigs/" + local_config["id"] + "/tags?ts=" + (+ new Date).toString())
                .then(function (res) {
                    if (res.status == 200) {
                        form["tags"] = res.data
                        var prefix = form["TAG_PREFIX"]
                        form["tags"].forEach(tag_el => {
                            mq.subscribe(clientId + "/" + local_config["id"] + "/" + prefix + tag_el["dataTagId"]);
                        });
                    }
                })
        }

        $scope.loadConfig = function ($http) {
            var clientId = localStorage.getItem("clientId") || $scope.clientId;

            $http.get(properties.get("CONFIG_URL_PREFIX") + "/clients/" + clientId + "/ingestconfigs")
                .then(function (response) {
                    if (response.status == 200) {
                        // > Deals with config green light/button only
                        if (!angular.equals($scope.forms, response.data)) {
                            //covers first time forms case
                            // console.log("first time")
                            var urlprefix = properties.get("CONFIG_URL_PREFIX") + "/ingestconfigs/"
                            var urlsuffix = "/statuses?ts=" + (+ new Date).toString()
                            Promise.all(response.data.map(u => $http.get(urlprefix + u["id"] + urlsuffix)))
                                .then(responses => Promise.all(responses.map(res => res.data)))
                                .then(texts => {
                                    // FORM PERFECTIONS
                                    var statuses = texts.map(x => x["status"]);

                                    // var statuses = texts.map(x => JSON.parse(x)["status"]);
                                    // assuming status is must!!!! for each config
                                    // VIMP 
                                    if (statuses.length == 0) {
                                        $scope.config_color = 'red';
                                    } else if (validateStatusOfAllConfigs(statuses)) {
                                        // console.log(statuses)
                                        console.log("all valid status")
                                        $scope.config_color = 'green';
                                    } else {
                                        $scope.config_color = 'red';
                                    }

                                })
                        }

                        // > Deals with individual config status
                        if ($scope.forms && $scope.forms.length > 0) {
                            for (let index = 0; index < $scope.forms.length; index++) {
                                // const local_config = $scope.forms[index];
                                // removed from here
                                // console.log("managing restart-----")
                                // manageRestart($http, $scope, local_config["id"])
                                manageRestart($http, $scope, $scope.forms[index]["id"], index)
                                //var clIds = [];
                                //for (var i = 0; i < $scope.forms.length; i++) {
                                //clIds.push($scope.forms[i].id);
                                //}
                            }
                        }
                    } else {
                        console.error(response.status)
                    }
                }).catch(function (e) {
                    console.error(e)
                });

        }

        // all load are for loading colored buttons only!
        $scope.submitClientRegistration = function () {
            if ($scope.clientId) {
                localStorage.setItem("clientId", $scope.clientId)
                // console.log($scope.clientId)
                $http.get(properties.get("CONFIG_URL_PREFIX") + "/clients/" + $scope.clientId + "/ingestconfigs")
                    .then(function (response) {
                        if (response.status == 200) {
                            $scope.registration_color = "green"
                            $scope.registration_msg = "Valid Client"
                            $scope.registration_class = "success"
                            localStorage.setItem("clientId", $scope.clientId);
                            localStorage.setItem("registration_color", "green");
                            $scope.displayForm();
                        } else {
                            $scope.registration_color = "red"
                            localStorage.setItem("registration_color", "red");
                            $scope.registration_msg = "Cloud error"
                            $scope.registration_class = "error"
                        }
                    }).catch(function (response) {
                        $scope.registration_color = "red" //404
                        localStorage.setItem("registration_color", "red")
                        $scope.registration_msg = "ClientID doesn't exist on remote machine"
                        $scope.registration_class = "error"
                    });

            }
        }

        var formObj = {
            "name": "name",
            "OPC_SERVER_USER": "",
            "OPC_SERVER_PASS": "",
            "OPC_SERVER_HOST": "localhost",
            "OPC_SERVER_PROGID": "",
            "OPC_SERVER_CLSID": "",
            "TAG_PREFIX": "",
            "SUBSCRIBE_INTERVAL": 60000
        }
        $scope.addForm = function () {
            // formObj.name = formObj.name + Math.floor(Math.random()*100).toString()
            $scope.forms.push(formObj)
        }
        $scope.addTag = function (form) {
            if (form.newTag) {
                $http.post(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + form.id + '/tags', json = { "dataTagId": form.newTag, "ingestconfigId": form.id })
                    .then(function (response) {
                        if (response.status == 200) {
                            console.log("tag saved!")
                            // $scope.forms[0].config_msg = 'Saved!'
                            // $scope.forms[formindex].status = 'Saved'
                            console.log(form.newTag)
                            if (form.newTag) {
                                console.log("in inf")
                                if (form.hasOwnProperty("tags")) {
                                    form.tags.push({ "dataTagId": form.newTag, "ingestconfigId": form.id })
                                } else {
                                    form.tags = [{ "dataTagId": form.newTag, "ingestconfigId": form.id }]
                                }
                                //form.tags.push({"dataTagId":form.newTag, "ingestconfigId": form.id})
                                form.newTag = ""
                            }

                        } else {
                            // console.error("Form save")
                            console.error(response.status)
                            // $scope.config_msg[0] = "Cloud error ",reponse.status 
                            // $scope.forms[formindex].status = 'Cloud error'
                            form.newTag = ""
                        }

                    }).catch(function (response) {
                        console.error(response)
                        form.newTag = ""
                    });
            }
        }
        $scope.deleteTag = function (form, index) {
            // console.log(properties.get("CONFIG_URL_PREFIX")+'/ingestconfigs/'+form.tags[index].configId+'/tags/'+form.tags[index].dataTagId)
            console.log(form.tags[index]);

            if (form.tags[index].dataTagId) {
                $http.delete(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + form.tags[index].ingestconfigId + '/tags/' + form.tags[index].id)
                    .then(function (response) {
                        if (response.status == 204) {
                            console.log("deleted!")
                            form.tags.splice(index, 1)
                            // $scope.forms[0].config_msg = 'Saved!'

                            // $scope.forms[formindex].status = 'Saved'
                            // form.tags.push({"dataTagId":form.newTag})
                        } else {
                            // console.error("Form save")
                            console.error(response.status)
                            // $scope.config_msg[0] = "Cloud error ",reponse.status 
                            // $scope.forms[formindex].status = 'Cloud error'
                        }

                    }).catch(function (response) {
                        console.error(response)
                    });
            }
        }
        $scope.displayForm = function () {
            var clientId = localStorage.getItem("clientId") || $scope.clientId;

            $http.get(properties.get("CONFIG_URL_PREFIX") + "/clients/" + clientId + "/ingestconfigs?ts=" + (+ new Date).toString())
                .then(function (response) {
                    if (response.status == 200) {
                        // delete tmp["id"]
                        // delete tmp["clientId"]
                        if (!angular.equals($scope.forms, response.data)) { //covers first time forms case
                            $scope.forms = response.data
                        }
                        $scope.loadConfig($http)
                    } else {
                        console.error(response.status)
                    }
                }).catch(function (e) {
                    console.error(e)
                });
        }
        $scope.deleteForm = function (index) {
            console.log(index)
            console.log("Calling delete")
      
          var configId = $scope.forms[index]["id"];

            if (confirm("Do you really want to delete this OPC server?")) {
                if (!configId) {
                    $scope.forms.splice(index, 1);
                } else {

                    $http.delete(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/' + configId)
                        .then(function (response) {
                            console.log(response.status)
                            if (response.status == 200) {
                                $scope.forms.splice(index, 1);

                                console.log("deleted!")

                                // $scope.forms[0].config_msg = 'Saved!'
                                // $scope.forms[formindex].status = 'Saved'
                            } else {
                                console.error(response.status)
                            }
                        }).catch(function (response) {
                            console.error(response)
                        });
                }
            }


        }

        $scope.classConvert = function (x) {
            if (x == "success") {
                return "greencircle"
            } else {
                return "redcircle"
            }

        }
        $scope.setForm = function (configId, formindex) {
            var clientId = localStorage.getItem("clientId") || $scope.clientId;
            var formcopy = angular.copy($scope.forms[formindex])
            delete formcopy["id"]
            delete formcopy["$$hashKey"]
            delete formcopy["status"]
            delete formcopy["status_class"]
            delete formcopy["config_msg"]
            delete formcopy["taglist"]
            // delete other items here also, beofre submit

            if (formcopy["PROG_ID_PREFER"]) {
                formcopy["PROG_ID_PREFER"] = 1
            } else {
                formcopy["PROG_ID_PREFER"] = 0
            }

            formcopy["TAG_PREFIX"] = formcopy["TAG_PREFIX"].toUpperCase()

            var tags = formcopy["tags"]
            delete formcopy["tags"]

            //validating the configs received first
            
            if (configId) { // that means need to update form
                console.log("update form")
                // saving opc configs
                $http.post(properties.get("CONFIG_URL_PREFIX") + '/ingestconfigs/update?where={"id":"' + configId + '"}', json = formcopy)
                    .then(function (response) {
                        if (response.status == 200) {
                            console.log("saved!")
                            // $scope.forms[0].config_msg = 'Saved!'
                            // $scope.forms[formindex].status = 'Saved'
                        } else {
                            // console.error("Form save")
                            console.error(response.status)
                            // $scope.config_msg[0] = "Cloud error ",reponse.status 
                            // $scope.forms[formindex].status = 'Cloud error'
                        }
                    }).catch(function (response) {
                        console.error(response)
                    });
            } else { // that means new form
                console.log("in new form")
                $http.post(properties.get("CONFIG_URL_PREFIX") + '/clients/' + clientId + '/ingestconfigs', json = formcopy)
                    .then(function (response) {
                        if (response.status == 200) {
                            // del response.data["id"]
                            console.log("saved!")
                            console.log(response.data)
                            // $scope.forms[0].config_msg = 'Saved!'
                            $scope.forms[formindex] = response.data
                        } else {
                            // console.error("Form save")
                            console.error(response.status)
                            // $scope.config_msg[0] = "Cloud error ",reponse.status 
                            // $scope.forms[formindex].status = 'Cloud error'
                        }
                    }).catch(function (response) {
                        console.error(response)
                    });
            }


        }


        $scope.unsubscribeTags = function (form) {
            if (form.hasOwnProperty("tags")) {
                console.log("unsubs")
                var tags = form["tags"]
                var prefix = form["TAG_PREFIX"]
                var configId = form.id
                var clientId = localStorage.getItem("clientId") || $scope.clientId;

                if (prefix && configId && clientId) {
                    tags.forEach(tag_el => {
                        mq.unsubscribe(clientId + "/" + configId + "/" + prefix + tag_el["dataTagId"]);
                    });
                } else {
                    console.log("Empty form or tags")
                }
            }

        }

        $scope.registration_color = 'red';
        $scope.config_color = 'red';
        $scope.network_color = 'red';
        $scope.network_class = "error"
        $scope.network_msg = "Connecting"

        //display once
        $scope.loadNetwork = function () {

            var clientId = localStorage.getItem("clientId") || "empty";

            var clientNetworkId = "network_clientId" + clientId;

        const start = performance.now();
        $http.post(properties.get("CONFIG_URL_PREFIX").replace("/exactapi", "") + "/opc-network", json = { clientNetworkId: 1 })
        .then(function (response) {
        const end = performance.now();
        responseTime = (end - start) / 10;
        console.log("status:" + response.status + ", response time: " + responseTime.toFixed(1));
        // if (response.status == 200){
        $scope.network_color = "green"
        $scope.network_class = "success"
        $scope.network_msg = "Connected"
        // } else{
        // $scope.network_color= "red"
        // $scope.network_class= "error"
        // $scope.network_msg = "Cloud error"
        // }
    }).catch(function (e) {
        const end = performance.now();
        responseTime = end - start;
        if (e.status === 401) {
            $scope.network_msg = "Authenticating..."
            authenticate($http, $scope).then((data) => {
                $scope.auth_token = data.data.id
                $http.defaults.headers.common.Authorization = $scope.auth_token
                $scope.network_color = "green"
                $scope.network_class = "success"
                $scope.network_msg = "Connected"
            }).catch((err) => {
                if (e.status !== 404) {
                    $scope.network_msg = "Wrong credentials"
                }
                else if (e.status !== 500) {
                    $scope.network_msg = "Internal Server Error"
                }
                else if (e.status !== 502) {
                    $scope.network_msg = "Bad Gateway"
                }
            })
        } else {
            $scope.network_color = "red"
            $scope.network_class = "error"
            $scope.network_msg = "Unable to contact cloud"
        }
        console.log("status:" + e.status + ", response time: " + responseTime.toFixed(1));
        // console.log(e)

    });

        }
        $scope.loadNetwork();
        // > Loading network call
        $scope.loadClientRegistration = function () {
            var clientId = localStorage.getItem("clientId") || $scope.clientId;
            $scope.clientId = clientId
            $scope.registration_color = localStorage.getItem("registration_color") || 'red';
        }
        $scope.loadClientRegistration();
        // > Loading persistent client registration

        // $scope.loadConfig();
        $scope.displayForm();   

        // $scope.loadTags();
        $scope.loadNetwork();
        // > every 5 seconds

        $interval(function () {
            $scope.loadConfig($http);
            var clientId = localStorage.getItem("clientId") || $scope.clientId;
            var d1 = new Date();
            var epochTime1 = d1.getTime();
            $scope.loadNetwork();
            //console.log(clientId + "/opc_health" )
            console.log(clientId + "/response_time" )
            //mq.publish(clientId + "/opc_health", JSON.stringify({"t": epochTime,"v": 1  })) 
            mq.publish(clientId + "/response_time", JSON.stringify({ "t": epochTime1, "v": responseTime.toFixed(1)})) 
        }, 60000);
    });
