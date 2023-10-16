const dotenv = require('dotenv')
const { config } = require('process')
const fetch = require('sync-fetch')
const { constants } = require('buffer')
const { OPCUAClient, makeBrowsePath, SecurityPolicy, MessageSecurityMode, AttributeIds, resolveNodeId, TimestampsToReturn } = require("node-opcua");
const async = require("async");
const { time } = require('console')
const mqtt = require('mqtt');
const { mixin } = require('lodash');
const { type } = require('os');
const fetchp = require('node-fetch')

dotenv.config({ path: './config.properties' })

let run_once = true

console.log(process.env.CONFIG_URL_PREFIX, "is base url")



function typeTransform(data, tag, itemsToScale) {
    try {
        let op = itemsToScale[tag]

        if (data === true) {
            return 1
        } else if (data === false) {
            return 0
        } else if (data === null) {
            return null
        } else {
            if (tag in itemsToScale) {
                let scaled_data = ((data / op["div"]) * op["mul"] - op["sub"] + op["add"])
                //console.log("scaled data", tag,data, scaled_data, op)
                return scaled_data.toFixed(5)
            }
            else {
                return data.toFixed(5)
            }
        }
    }
    catch (e) {
        console.log("typeTransform error", e)
        return null
    }
}
function notHaveInitVariables(dict) {
    if ((dict.MQTT_URL == "") || (dict.CONFIG_URL_PREFIX == "")) {
        return 1
    }
    return 0
}

function notHaveConfigVariables(dict) {
    console.log(dict.TAG_PREFIX, "is prefix")
    console.log(dict.taglist.length, "tags found")
    console.log(dict.SUBSCRIBE_INTERVAL, "is subscribe interval")
    // if (!dict.OPC_SERVER_USER || !(dict.PROG_ID_PREFER).toString || !dict.taglist || !dict.OPC_SERVER_HOST || (!dict.OPC_SERVER_CLSID && !dict.OPC_SERVER_PROGID)) {
    if (!dict.taglist || !dict.SUBSCRIBE_INTERVAL) {
        return 1
    }
    return 0
}

function getConfig(dict) {
    let URI = dict.CONFIG_URL_PREFIX + "/clients/" + dict.CLIENT_ID + "/ingestconfigs/" + dict.CONFIG_ID
    const config = fetch(URI, {
        headers: glob_headers
    }).json()
    URI = dict.CONFIG_URL_PREFIX + "/ingestconfigs/" + dict.CONFIG_ID + "/tags"
    console.log(URI)
    const tags = fetch(URI, {
        headers: glob_headers
    }).json()
    config.taglist = tags
    return config
}

function setStatus(dict) {

    let URI = dict.CONFIG_URL_PREFIX + "/ingestconfigs/" + dict.CONFIG_ID + "/statuses"
    const status = fetch(URI, {
        headers: glob_headers
    }).json()

    URI = dict.CONFIG_URL_PREFIX + '/statuses/update?where={"id":"' + status["id"] + '"}'
    const metadata = fetch(URI, {
        method: "POST",
        body: JSON.stringify({ "status": process.env.STATUS || 0, "time": (+new Date() + 2 * 19800), "requireRestart": false }),
        headers: glob_headers
    })
    if (metadata.status == 200) {
        console.log("status successfully updated at", (+new Date() + 2 * 19800))
        return 1
    }
    return 0
}

//
function authenticate() {
    return fetchp(process.env.CONFIG_URL_PREFIX + "/Users/login", {
        "headers": {
            "content-type": "application/json;charset=UTF-8",
            "Accept": "application/json"
        },
        "body": "{\"email\":\"" + process.env.API_AUTH_USERNAME + "\",\"password\":\"" + process.env.API_AUTH_PASSWORD + "\"}",
        "method": "POST"
    })
}

//------------------main program-----------------------

// New flow for authentication

let glob_headers = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Authorization": ""
}

if (notHaveInitVariables(process.env)) {
    console.error("Config.properties incomplete")
    process.exit()
}


fetchp(process.env.CONFIG_URL_PREFIX.replace("/exactapi", "/opc-network"), {
    "headers": {
        "withCredentials": true
    }
})
    .then(function (response) {
        if (!response.ok) {
            return authenticate()
        }
        return response
    })
    .then(response => response.json())
    .then(function (data) {

        try {
            glob_headers["Authorization"] = data.id
            console.log("Authenticated")
        } catch (e) {
        }

        if (process.argv.length > 2) {
            process.env.CLIENT_ID = process.argv[2]
            process.env.CONFIG_ID = process.argv[3]
            process.env.STATUS = 1
            let testmode = false;


            if (process.env.CLIENT_ID == "test" || process.env.CLIENT_ID == "TEST") {
                let testmode = true;
                process.env.OPC_SERVER_HOST = process.argv[4]

                // process.env.OPC_SERVER_PORT=process.argv[4]
                // process.env.OPC_SERVER_PATH=process.argv[5]
                process.env.TAG_PREFIX = process.argv[5]
                process.env.SUBSCRIBE_INTERVAL = process.argv[6]
                process.env.taglist = '["' + process.argv[7] + '"]'
                process.env.OPC_SERVER_CLSID = process.argv[8]
                process.env.OPC_SERVER_USER = process.argv[9]
                process.env.OPC_SERVER_PASS = process.argv[10]
            } else {

                // setStatus(process.env)
                process.env.STATUS = 0
                if (!setStatus(process.env)) {
                    console.error("STATUS not initiated, retry START")
                    process.exit()
                }

                // MOVES only if able to set status (handled at OPC client side to create status if not)
                let config = getConfig(process.env)

                if (config.length < 1) {
                    console.error("Config not created at cloud")
                    process.exit()
                }
                if (notHaveConfigVariables(config)) {
                    console.error("Config incomplete, exitting.")
                    process.exit()
                }

                // Moves only if config created at cloud
                for (param in config) {
                    if (typeof (config[param]) == "object") {
                        process.env[param] = JSON.stringify(config[param])
                    } else {
                        process.env[param] = config[param].toString()
                    }
                }
            }

        } else {
            console.error("Run time arguments incomplete")
            process.exit()
        }


        //config available
        console.log("**********Initializing OPC Client**********")


        const nodeId = process.env.OPC_ROOT_NODE;

        // const endpointUrl = "opc.tcp://" + process.env.OPC_SERVER_HOST + ":"+process.env.OPC_SERVER_PORT+process.env.OPC_SERVER_PATH;
        const endpointUrl = process.env.OPC_SERVER_HOST;
        // const serverProgID = process.env.OPC_SERVER_PROGID;
        // // const progIDArray = serverProgID.split(";");

        // console.log("endpointUrl:::"+endpointUrl);

        // let securityPolicy, securityMode;
       
        // if (progIDArray.length === 2) {
        //   securityPolicy = progIDArray[0].trim();
        //   securityMode = progIDArray[1].trim();

         
        // } else {
        //   securityPolicy = "None";
        //   securityMode = "None";
          
        // }
        // console.log("Using security Policy as:"+securityPolicy);
        // console.log("Using security Mode as:"+securityMode);

        // const client = OPCUAClient.create({
        //   endpoint_must_exist: false,
        //   securityPolicy: SecurityPolicy[securityPolicy],
        //   securityMode: MessageSecurityMode[securityMode],
        // });

        

    



       
        // let securityPolicy, securityMode;
       
        // if (progIDArray.length === 2) {
        //   securityPolicy = progIDArray[0].trim();
        //   securityMode = progIDArray[1].trim();

         
        // } else {
        //   securityPolicy = "None";
        //   securityMode = "None";
          
        // }
        console.log("Using security Policy as:"+process.env.OPC_SERVER_SECURITY_POLICY);
        console.log("Using security Mode as:"+process.env.OPC_SERVER_SECURITY_MODE);

        console.log(typeof process.env.OPC_SERVER_SECURITY_POLICY);
        console.log(typeof process.env.OPC_SERVER_SECURITY_MODE);

        const client = OPCUAClient.create({
          endpoint_must_exist: false,
          securityPolicy: SecurityPolicy[process.env.OPC_SERVER_SECURITY_POLICY],
          securityMode: MessageSecurityMode[process.env.OPC_SERVER_SECURITY_MODE],
        });

       

   
        // const client = OPCUAClient.create({
        //     "endpoint_must_exist": false,
        //     "securityPolicy": SecurityPolicy.Basic256Sha256,
        //     "securityMode": MessageSecurityMode.SignAndEncrypt
        // });
        
       
       

        console.log("**********Attempting to connect to OPC**********")


        let the_session, the_subscription;
        // const MQclient  = mqtt.connect(process.env.MQTT_URL)
        const MQclient = mqtt.connect(process.env.MQTT_URL, {
            keepalive: 120,
            username: process.env.MQTT_AUTH_USERNAME,
            password: process.env.MQTT_AUTH_PASSWORD
        });

        MQclient.on('connect', function () {
            console.log("**********Connected to BROKER**********");
            //callback();
        })
        async.series([
            function (callback) {
                callback();

            },

            function (callback) {
                client.connect(endpointUrl, function (err) {
                    if (err) {
                        console.log("---------cannot connect to endpoint------------:", endpointUrl);
                    } else {
                        console.log("**********Successfully Connected to OPC-UA**********");
                    }
                    callback(err);
                });
            },

            function (callback) {
                if (process.env.OPC_SERVER_PASS) {
                    //client.createSession({"userName": process.env.OPC_SERVER_USER, "password":process.env.OPC_SERVER_PASS}, function(err, session) {
                    client.createSession(function (err, session) {
                        if (err) {
                            return callback(err);
                        }
                        the_session = session;
                        callback();
                    });
                } else {
                    client.createSession(function (err, session) {
                        if (err) {
                            return callback(err);
                        }
                        the_session = session;
                        callback();
                    });
                }

            },
            function (callback) {

                const subscriptionOptions = {
                    maxNotificationsPerPublish: 5000,
                    publishingEnabled: true,
                    requestedLifetimeCount: 100,
                    requestedMaxKeepAliveCount: 10
                    // requestedPublishingInterval: 60000
                    // publishingInterval: 60000
                };
                the_session.createSubscription2(subscriptionOptions, (err, subscription) => {
                    if (err) {
                        return callback(err);
                    }

                    the_subscription = subscription;

                    callback();
                });
            },
            function (callback) {
                console.log("Susbcribe interval", process.env.SUBSCRIBE_INTERVAL)
                const monitoringParamaters = {
                    samplingInterval: parseInt(10000),
                    discardOldest: true,
                    queueSize: 10
                };

                let itemsToMonitor = []
                let itemsToScale = {}
                tags = JSON.parse(process.env.taglist)

                let access_way;

                tags.forEach(function (tag) {

                    if (tag["scalefactor"]) {
                        itemsToScale[tag["dataTagId"]] = tag["scalefactor"];
                    }
                })

                console.log("items to scale", itemsToScale)


                // console.log("OPC_SERVER_CLSID::::"+process.env.OPC_SERVER_CLSID);
                const  CLS_ID = process.env.OPC_SERVER_CLSID;
                const CLS_ID_Array = CLS_ID.split(";");
                console.table("CLS_ID_Array::"+CLS_ID_Array);


                const nameSpace_Id = CLS_ID_Array[0];
                const prefix_Id = CLS_ID_Array[1] ;
                const suffix_Id = CLS_ID_Array[2];


                
                
                console.log(nameSpace_Id);
                console.log(typeof prefix_Id);
                console.log(suffix_Id);

                

                tags.forEach(function (tag) {

                    try {
                        if (tag["address"]) {

                            address = tag["address"]
                            console.log("attributeId::::",AttributeIds.Value);
                            console.log("nodeId:::::","ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + address
                            );
                            itemsToMonitor.push({
                                attributeId: AttributeIds.Value,
                                nodeId: "ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + address

                            })
                        } else {
                            tag = tag["dataTagId"]

                            console.log("attributeId::::",AttributeIds.Value);
                            console.log("nodeId:::::","ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + process.env.OPC_SERVER_ADDRESS_PREFIX + tag + process.env.OPC_SERVER_ADDRESS_SUFFIX
                            );

                            itemsToMonitor.push({
                                attributeId: AttributeIds.Value,
                                nodeId: "ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + process.env.OPC_SERVER_ADDRESS_PREFIX + tag + process.env.OPC_SERVER_ADDRESS_SUFFIX
                            })
                        }

                    } catch (error) {
                        console.log("tag addition error", error)

                    }
                })


                // tags.forEach(function (tag) {
                //     try {
                //         if (tag && tag["address"] !== undefined && tag["address"] !== null) {
                //             // Handle tag with "address" property
                //             address = tag["address"];
                //         } else if (tag && typeof tag["dataTagId"] === "number") {
                //             // Handle tag with "dataTagId" property as a number
                //             address = process.env.OPC_SERVER_ADDRESS_PREFIX + tag["dataTagId"] + process.env.OPC_SERVER_ADDRESS_SUFFIX;
                //         } else {
                //             // Skip this iteration and move to the next tag if both "address" and "dataTagId" are not valid
                //             console.log("Invalid tag format, skipping this tag.");
                //             return;
                //         }
                
                //         console.log("attributeId::::", AttributeIds.Value);
                //         console.log("nodeId:::::", "ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + address);
                
                //         itemsToMonitor.push({
                //             attributeId: AttributeIds.Value,
                //             nodeId: "ns=" + process.env.OPC_SERVER_CLSID + ";" + process.env.OPC_SERVER_PREFERENCE + "=" + address
                //         });
                //     } catch (error) {
                //         console.log("Error occurred while processing a tag:", error);
                //         // Handle the error as needed, e.g., logging the error or taking appropriate actions.
                //     }
                // });
                
                



                // tags.forEach(function (tag) {
                //     // let access_way;
                //     if (process.env.PROG_ID_PREFER !== "1") {
                //         if (tag && tag["dataTagId"] !== undefined && tag["dataTagId"] !== null) {
                //             tag = tag["dataTagId"];
                           
                //             access_way = ";s=";
                        // } else {
                        //     console.log("dataTagId is undefined or null, skipping this tag.");
                        //     return; // Skip this iteration and move to the next tag
                        // }
                //     } else {
                //         if (tag && tag["address"] !== undefined && tag["address"] !== null) {
                //             tag = tag["address"];
                            
                //             access_way = ";i=";
                        // } else {
                        //     console.log("address is undefined or null, skipping this tag.");
                        //     return; // Skip this iteration and move to the next tag
                        // }
                //     }
                
                //     let temp = {
                //         attributeId: AttributeIds.Value,
                //         nodeId: "ns=" + `${nameSpace_Id}` + access_way + tag 
                //         // Add other properties if needed
                //         // nodeId: "ns=" + nameSpace_Id +";" + prefix_Id + access_way + tag + ";" + suffix_Id

                //     };
                
                //     console.log(temp);
                
                //     itemsToMonitor.push(temp);
                // });
                

             
                

                // tags.forEach(function (tag) {

                   
                //     if (process.env.PROG_ID_PREFER !="1") {


                //         try {
                            
                //                 tag = tag["dataTagId"]

                //                 console.log("tag of S wala (process.env.PROG_ID_PREFER !=1)"+tag);

                //                 access_way = ";s="
                          

                //         } catch (error) {
                //             console.log("tag addition error", error)

                //         }
                //     } else  {
                //         tag = tag["address"]
                //         console.log("tag of I wala (process.env.PROG_ID_PREFER !=1)"+tag);
                //         access_way = ";i="
                //     }

                //     let temp = {
                //         attributeId: AttributeIds.Value,
                //         nodeId: "ns=" + `${nameSpace_Id}` + access_way +  tag 
                //         // nodeId: "ns=" + `${nameSpace_Id}` + `${prefix_Id}`+access_way  +tag + "; "`${suffix_Id}`
                //         // nodeId: "ns=" + nameSpace_Id +";" + prefix_Id + access_way + tag + ";" + suffix_Id


                //     }
                    
                //     console.log(temp);
                //     console.log("type of nodeID:::"+typeof temp.nodeId);

                //     itemsToMonitor.push(temp)
                // })


//                 console.log("Debug - nameSpace_Id: " + nameSpace_Id);
// console.log("Debug - prefix_Id: " + prefix_Id);
// console.log("Debug - access_way: " + access_way);
// console.log("Debug - tag: " + tag);
// console.log("Debug - suffix_Id: " + suffix_Id);

// let temp = {
//     attributeId: AttributeIds.Value,
//     nodeId: "ns=" + nameSpace_Id + prefix_Id + access_way + tag + ";" + suffix_Id
// };

// console.log("Debug - constructed nodeId: " + temp.nodeId);

// itemsToMonitor.push(temp);
// })

                // tags.forEach(function (tag) {

                   
                //     if (process.env.PROG_ID_PREFER=="1") {


                //         try {
                //             if (tag["address"]) {
                //                 tag = tag["address"]
                //                 access_way = ";s="
                //             } else {
                //                 tag = tag["dataTagId"]
                //                 access_way = ";s=Channel2.Device1."
                //             }

                //         } catch (error) {
                //             console.log("tag addition error", error)
                //             access_way = ";s=Channel2.Device1."

                //         }
                //     } else {
                //         tag = tag["dataTagId"]
                //         access_way = ";i="
                //     }

                //     let temp = {
                //         attributeId: AttributeIds.Value,
                //         nodeId: "ns=" + process.env.OPC_SERVER_CLSID + access_way + tag
                //     }
                //     console.log("hello"+process.env.OPC_SERVER_CLSID);
                //     console.log("kkkk::"+temp.nodeId);
                //     console.log(temp);
                //     itemsToMonitor.push(temp)
                // })

                let status_count = 0
                console.log("items monitoring starts -------")

                the_subscription.monitorItems(
                    itemsToMonitor,
                    monitoringParamaters,
                    TimestampsToReturn.Both, function (err, mItems) {
                        if (err) {
                            console.log("error in monitoring items", err)
                        }
                        mItems.on("changed", function (monitoredItem, dataValue, index) {
                            //console.log(" The value has changed : ",monitoredItem, dataValue);  
                            //let ts = +new Date(dataValue.sourceTimestamp.toString());
                            let ts = +new Date();
                            let topic_line = process.env.CLIENT_ID + "/" + process.env.CONFIG_ID + "/" + process.env.TAG_PREFIX + tags[index].dataTagId


                            if (status_count == 100) {
                                setStatus(process.env)
                                status_count = 0
                            }

                            status_count = status_count + 1

                            try {

                                let payload = JSON.stringify({ "v": typeTransform(dataValue.value.value, tags[index].dataTagId, itemsToScale), "t": ts })
                                MQclient.publish(topic_line, payload)
                                console.log("topic ", topic_line, payload)
                            } catch (e) {
                                console.log(e)
                            }
                            if (process.env.CLIENT_ID == "test" || process.env.CLIENT_ID == "TEST") {
                                setTimeout(() => process.exit(), 5000);
                            }

                        });
                    })

                console.log("-----------------Subscription Added--------------------");
                process.env.STATUS = 1


                setInterval(() => {
                    fetchp(process.env.CONFIG_URL_PREFIX.replace("/exactapi", "/opc-network"), {
                        "headers": {
                            "withCredentials": true
                        }
                    })
                        .then(function (response) {
                            if (!response.ok) {
                                return authenticate()
                            }
                            return response
                        })
                        .then(response => response.json())
                        .then(function (data) {

                            try {
                                glob_headers["Authorization"] = data.id
                                console.log(data.id)
                                console.log("Authenticated")
                            } catch (e) {
                            }
                        })

                }, 300000)

            },
            function (callback) {
                //to keep event loop on
                console.log("+++++++++++++++++++++++++++++++++++")
                //setTimeout(()=>callback(), 999999); 
            }


        ],
            function (err) {
                if (err) {
                    console.log(" failure ", err);
                } else {
                    console.log("done!");
                }
                client.disconnect(function () { });
            });
    })
